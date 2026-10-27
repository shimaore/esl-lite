/**
 * The main Socket class
 *
 * Event Socket client mode can be used to place new calls or take over existing calls.
 */

import { Socket } from 'node:net'
import { sleep } from './sleep.js'
import { type Logger } from 'pino'
import { FreeSwitchEventEmitter } from './event-emitter.js'
import { ulid } from 'ulidx'

/**
 * How long `end()` waits for the remote end to finish closing before the
 * socket is destroyed. `socket.end()` only sends our FIN; if the remote never
 * answers with its own, the socket stays half-open until TCP keepalive gives up.
 */
const END_FORCE_CLOSE_MS = 2_000

export class FreeSwitchSocket {
  private readonly options: {
    host: string
    port: number
    maxRetryTimeout: number
  }

  private running = true
  private readonly logger: Logger
  public readonly ref = ulid()

  /**
   * Create a new client that will attempt to connect to a FreeSWITCH Event Socket.
   * @param options.host default: `127.0.0.1`
   * @param options.port default: 8021
   * @param options.logger default: `console` Object
   */
  constructor(options: {
    host: string
    port: number
    maxRetryTimeout?: number
    logger: Logger
  }) {
    this.logger = options.logger.child({
      module: 'FreeSwitchSocket',
      ref: this.ref,
    })
    this.options = {
      host: options.host,
      port: options.port,
      maxRetryTimeout: options.maxRetryTimeout ?? 1_000,
    }
  }

  private readonly ee = new FreeSwitchEventEmitter<'end', { end: () => void }>()

  /**
   * Start connecting to FreeSwitch, reconnect if needed
   */
  connect(): AsyncIterable<Socket> {
    return async function* (this: FreeSwitchSocket) {
      let retry = 200
      let attempt = 0n
      while (this.running) {
        attempt++
        // Create a new socket connection
        const socket = new Socket()

        const endHandler = (): void => {
          socket.end()
          const forceClose = setTimeout(() => {
            if (socket.destroyed) return
            this.logger.info({}, 'Remote end did not close, destroying socket')
            socket.destroy()
          }, END_FORCE_CLOSE_MS)
          forceClose.unref()
          socket.once('close', () => {
            clearTimeout(forceClose)
          })
        }
        try {
          this.logger.debug(
            {
              options: this.options,
              attempt: attempt,
              retry: retry,
            },
            'Attempt to connect'
          )

          const connected = new Promise<unknown>((resolve) => {
            socket.once('connect', resolve)
          }).then(() => true)

          const ended = new Promise<unknown>((resolve, reject) => {
            socket.once('error', reject)
            socket.once('end', resolve)
            socket.once('close', resolve)
          }).then(() => false)

          this.ee.once('end', endHandler)

          socket.connect(this.options)
          const success = await Promise.race([connected, ended])
          if (success) {
            this.logger.info({ attempt, retry }, 'Connected')
            socket.setKeepAlive(true)
            socket.setNoDelay(true)
            yield socket
          }

          const reason = await ended
          this.logger.info(
            { attempt: attempt, retry: retry, reason },
            'Socket completed (remote end sent a FIN packet)'
          )
          socket.removeAllListeners()
        } catch (error: unknown) {
          const code =
            typeof error === 'object' && error != null && 'code' in error
              ? error.code
              : undefined
          if (retry < this.options.maxRetryTimeout) {
            if (code === 'ECONNREFUSED') {
              retry = Math.floor((retry * 1200) / 1000)
            }
          } else {
            retry = this.options.maxRetryTimeout
          }
          this.logger.error(
            {
              attempt,
              retry,
              error,
              code,
            },
            'Socket failed'
          )
          socket.removeAllListeners()
          if (this.running) {
            await sleep(retry)
          }
        } finally {
          this.ee.removeListener('end', endHandler)
        }
      }
      this.logger.info({ running: this.running }, 'Disconnected')
    }.bind(this)()
  }

  /**
   * Close the current connection to FreeSwitch and stop attempting to reconnect
   */
  end(): void {
    this.logger.info({}, 'end requested by application')
    this.running = false
    this.ee.emit('end', undefined)
  }
}
