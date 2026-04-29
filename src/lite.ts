import {
  FreeSwitchParser,
  FreeSwitchParserNonEmptyBufferAtEndError,
} from './parser.js'
import { FreeSwitchSocket } from './socket.js'
import { FreeSwitchEventEmitter } from './event-emitter.js'
import {
  FreeSwitchDisconnectNotice,
  ProcessedEvents,
  processRawEvent,
} from './raw-event.js'
import { type Logger } from 'pino'
import { ulid } from 'ulidx'

export class EslLite {
  public readonly ref = ulid()

  /**
   * Create a new client that will attempt to connect to a FreeSWITCH Event Socket.
   */
  constructor(options: { host: string; port: number; logger: Logger }) {
    this.sockets = new FreeSwitchSocket(options)
    this.logger = options.logger.child({ module: 'EslLite', ref: this.ref })
  }

  private readonly sockets: FreeSwitchSocket
  private readonly logger: Logger

  private ee = new FreeSwitchEventEmitter<
    'write',
    {
      write: (request: WriteRequest) => void
    }
  >()

  write(request: WriteRequest) {
    this.ee.emit('write', request)
  }

  connect(): AsyncIterable<
    FreeSwitchParserNonEmptyBufferAtEndError | ProcessedEvents
  > {
    return async function* (this: EslLite) {
      this.logger.debug({}, 'connect')
      for await (const socket of this.sockets.connect()) {
        const pendingWrites: WriteRequest[] = []
        let lastWrite: WriteRequest | undefined = undefined

        const drain = () => {
          if (lastWrite !== undefined) return
          while (pendingWrites.length > 0) {
            const req = pendingWrites.shift()
            if (req === undefined) return
            try {
              const flushed = socket.write(req.buf)
              if (!flushed) {
                lastWrite = req
                return
              }
              req.resolve(undefined)
            } catch (err) {
              req.resolve(new FreeSwitchWriteError(err))
              return
            }
          }
        }

        socket.on('drain', () => {
          lastWrite?.resolve(undefined)
          lastWrite = undefined
          drain()
        })

        const writer = (request: WriteRequest) => {
          pendingWrites.push(request)
          drain()
        }

        this.ee.on('write', writer)
        this.logger.debug({}, 'connected')

        try {
          for await (const event of FreeSwitchParser(socket, this.logger)) {
            if (event instanceof Error) {
              yield event
            } else {
              const ev = processRawEvent(event)
              yield ev
              /* Disconnect notice is a graceful close — let the socket drain naturally
               * so the parser can emit NonEmptyBufferAtEnd if junk data follows. */
              if (
                ev instanceof Error &&
                !(ev instanceof FreeSwitchDisconnectNotice)
              ) {
                break
              }
            }
          }
        } catch (err) {
          this.logger.error({ err }, 'connect')
        }
        this.ee.removeListener('write', writer)
        try {
          const closeErr = new FreeSwitchWriteError('socket closed')
          const all = lastWrite !== undefined ? [lastWrite, ...pendingWrites.splice(0)] : pendingWrites.splice(0)
          lastWrite = undefined
          all.forEach((req) => req.resolve(closeErr))
        } catch (err) {
          this.logger.error({ err }, 'resolve')
        }
        socket.end()
      }

      this.logger.info({}, 'Application ended')
    }.bind(this)()
  }

  end() {
    this.logger.debug({}, 'Calling sockets.end')
    this.sockets.end()
  }
}

export class FreeSwitchWriteError extends Error {
  override name = 'FreeSwitchWriteError' as const
  constructor(err: unknown) {
    super('Write error', { cause: err })
  }
}

export type WriteRequest = {
  buf: Buffer
  resolve: (outcome: undefined | FreeSwitchWriteError) => void
}
