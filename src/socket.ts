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
export class FreeSwitchSocket {
  private readonly options: {
    host: string
    port: number
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
  constructor(options: { host: string; port: number; logger: Logger }) {
    this.logger = options.logger.child({
      module: 'FreeSwitchSocket',
      ref: this.ref,
    })
    this.options = {
      host: options.host,
      port: options.port,
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
        this.logger.debug(
          {
            options: this.options,
            attempt: attempt,
            retry: retry,
          },
          'Attempt to connect'
        )
        // Create a new socket connection
        const socket = new Socket()

        let resolver = undefined as undefined | ((r: unknown) => void)

        const connected = new Promise<void>((resolve) =>
          socket.once('connect', resolve)
        ).then(() => true)

        const ended = new Promise<unknown>((resolve, reject) => {
          socket.once('error', reject)
          socket.once('end', resolve)
          resolver = resolve
        }).then(() => false)

        this.ee.once('end', () => {
          socket.end()
        })

        try {
          socket.connect(this.options)
          const success = await Promise.race([connected, ended])
          if (success) {
            socket.setKeepAlive(true)
            socket.setNoDelay(true)
            yield socket
          }

          const reason = await ended
          this.logger.debug(
            { attempt: attempt, retry: retry, reason },
            'Socket completed (remote end sent a FIN packet)'
          )
        } catch (error: unknown) {
          const code =
            typeof error === 'object' && error != null && 'code' in error
              ? error.code
              : undefined
          if (retry < 5000) {
            if (code === 'ECONNREFUSED') {
              retry = Math.floor((retry * 1200) / 1000)
            }
          }
          this.logger.error(
            {
              attempt: attempt,
              retry: retry,
              error,
              code,
            },
            'Socket failed'
          )
          if (this.running) {
            await sleep(retry)
          }
        } finally {
          if (resolver != null) {
            socket.off('error', resolver)
            socket.off('end', resolver)
          }
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
