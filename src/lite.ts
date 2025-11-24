import {
  FreeSwitchParser,
  FreeSwitchParserNonEmptyBufferAtEndError,
} from './parser.js'
import { FreeSwitchSocket } from './socket.js'
import { Socket } from 'node:net'
import { FreeSwitchEventEmitter } from './event-emitter.js'
import { ProcessedEvents, processRawEvent } from './raw-event.js'
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
        try {
          const writer = (request: WriteRequest) => {
            this._write(socket, request)
          }

          this.ee.on('write', writer)

          this.logger.debug({}, 'connected')

          for await (const event of FreeSwitchParser(socket, this.logger)) {
            if (event instanceof Error) {
              yield event
            } else {
              const ev = processRawEvent(event)
              yield ev
              /* Currently none of these errors are recoverable */
              if (ev instanceof Error) {
                break
              }
            }
          }

          this.ee.removeListener('write', writer)

          socket.end()
        } catch (err) {
          this.logger.error({ err }, 'connect')
        }
      }

      this.logger.info({}, 'Application ended')
    }.bind(this)()
  }

  private _write(socket: Socket, request: WriteRequest) {
    try {
      const flushed = socket.write(request.buf)

      /* Do not resolve until the request is actually flushed */
      if (!flushed) {
        this.logger.debug({}, 'Waiting for FreeSwitch to drain messages')
        socket.once('drain', () => {
          request.resolve(undefined)
        })
      } else {
        request.resolve(undefined)
      }
    } catch (err) {
      request.resolve(new FreeSwitchWriteError(err))
    }
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
