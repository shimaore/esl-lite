/**
 * The main Client class
 *
 * Event Socket client mode can be used to place new calls or take over existing calls.
 */

import { Socket } from 'node:net'

import {
  AbortSignalEventEmitter,
  FreeSwitchEventEmitter,
} from './event-emitter.js'

import { FreeSwitchResponse } from './response.js'
import { FreeSwitchParserNonEmptyBufferAtEndError } from './parser.js'

const defaultPassword = 'ClueCon'

/**
 * An individual logger
 *
 * Each logging function must accept a message and optional data.
 */
export type Logger = (msg: string, data?: unknown) => void

/**
 * `esl-lite` is agnostic as to which logger you use.
 *
 * Each logging function must accept a message and optional data.
 *
 * To disable logging for a level, use an empty function:
 * ```ts
 * const logger = {
 *   debug: () => {}
 *   info: (msg,data) => logger.info(data,msg)
 *   error: (msg,data) => logger.error(data,msg)
 * }
 * const client = new FreeSwitchClient({ logger })
 * ```
 */
export interface FreeSwitchClientLogger {
  debug: Logger
  info: Logger
  error: Logger
}

/**
 * Events for the FreeSwitchClient class.
 */
export interface FreeSwitchClientEvents {
  /**
   * `connect` is emitted when the client connects or reconnects to the Event Socket
   */
  connect: (call: FreeSwitchResponse) => void
  /**
   * `error` is emitted when the underlying socker is in error, or when an
   * error occurs at connection time.
   *
   * This is informative only: those errors are corrected automatically.
   */
  error: (error: unknown) => void
  /**
   * `warning` is emitted when some error occurs in the parser
   *
   * This is informative only: those errors are corrected automatically.
   */
  warning: (data: FreeSwitchParserNonEmptyBufferAtEndError) => void
  /**
   * `reconnecting` is emitted when the client was disconnected and will attempt a reconnection
   */
  reconnecting: (retry_timeout: number) => void
  /**
   * `end` is emitted when the `end()` method is called
   */
  end: () => void
}

/**
 * FreeSwitchClient is the function you use to create a new client.
 * It will automatically reconnect.
 *
 * ```ts
 * const client = new FreeSwitchClient()
 * client.on('connect', (service) => {
 *   // ^^ the connect callback is not async
 *
 *   (async function() {
 *
 *     const res = await service.bgapi('sofia status', 1000)
 *     console.log('sofia status is', res)
 *
 *    })().catch( console.error )
 *
 * })
 *
 * client.connect()
 * ```
 * `service` is a [`FreeSwichResponse`](../classes/response.FreeSwitchResponse) object
 */
export class FreeSwitchClient extends FreeSwitchEventEmitter<
  keyof FreeSwitchClientEvents,
  FreeSwitchClientEvents
> {
  private readonly options: {
    host: string
    port: number
    password: string
  }

  private current_call: FreeSwitchResponse | undefined = undefined
  private running = true
  private retry = 200
  private attempt = 0n
  private readonly logger: FreeSwitchClientLogger
  /**
   * Create a new client that will attempt to connect to a FreeSWITCH Event Socket.
   * @param options.host default: `127.0.0.1`
   * @param options.port default: 8021
   * @param options.password default: `ClueCon`
   * @param options.logger default: `console` Object
   */
  constructor(options?: {
    host?: string
    port?: number
    password?: string
    logger?: FreeSwitchClientLogger
  }) {
    super()
    this.logger = options?.logger ?? console
    this.options = {
      host: '127.0.0.1',
      port: 8021,
      password: defaultPassword,
      ...(options ?? {}),
    }
    this.logger.info(
      'FreeSwitchClient: Ready to start Event Socket client, use connect() to start.'
    )
  }

  /**
   * Start connecting to FreeSwitch, reconnect if needed
   */
  connect(): void {
    if (!this.running) {
      this.logger.debug('FreeSwitchClient::connect: not running, aborting', {
        options: this.options,
        attempt: this.attempt,
      })
      return
    }
    this.attempt++
    this.logger.debug('FreeSwitchClient::connect', {
      options: this.options,
      attempt: this.attempt,
      retry: this.retry,
    })
    // Destroy any existing socket
    this.current_call?.end('New connection was opened.')
    // Create a new socket connection
    const socket = new Socket()
    this.current_call = new FreeSwitchResponse(socket, this.logger)
    const reconnect = this.connect.bind(this)
    const reconnectMaybe = (): void => {
      if (this.running) {
        this.emit('reconnecting', this.retry)
        setTimeout(reconnect, this.retry)
      }
    }

    socket.once('connect', () => {
      const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
      ;(async (): Promise<void> => {
        // Normally when the client connects, FreeSwitch will first send us an authentication request. We use it to trigger the remainder of the stack.
        const r1 = await this.current_call?.oncePrivateAsync(
          'freeswitch_auth_request',
          20_000,
          signal
        )
        if (r1 instanceof Error) {
          reconnectMaybe()
          return
        }
        const r2 = await this.current_call?.auth(this.options.password)
        if (r2 instanceof Error) {
          reconnectMaybe()
          return
        }
        const r3 = await this.current_call?.event_json([
          'CHANNEL_EXECUTE_COMPLETE',
          'BACKGROUND_JOB',
        ])
        if (r3 instanceof Error) {
          reconnectMaybe()
          return
        }
        if (this.running && this.current_call != null) {
          this.emit('connect', this.current_call)
        }
      })().catch((err: unknown) => {
        signal.emit('abort', undefined)
        this.logger.error('FreeSwitchClient: internal error', err)
        reconnectMaybe()
      })
    })

    socket.once('error', (error) => {
      const code = 'code' in error ? error.code : undefined
      if (this.retry < 5000) {
        if (code === 'ECONNREFUSED') {
          this.retry = Math.floor((this.retry * 1200) / 1000)
        }
      }
      this.logger.error(
        'FreeSwitchClient::connect: client received `error` event',
        { attempt: this.attempt, retry: this.retry, error, code }
      )
      if (this.running) {
        this.emit('reconnecting', this.retry)
        setTimeout(reconnect, this.retry)
      }
    })

    socket.once('end', () => {
      this.logger.debug(
        'FreeSwitchClient::connect: client received `end` event (remote end sent a FIN packet)',
        { attempt: this.attempt, retry: this.retry }
      )
      reconnectMaybe()
    })

    this.current_call.parserEventEmitter.on('error', (data) => {
      if (data instanceof FreeSwitchParserNonEmptyBufferAtEndError) {
        this.emit('warning', data)
      }
    })

    try {
      this.logger.debug('FreeSwitchClient::connect: socket.connect', {
        options: this.options,
        attempt: this.attempt,
        retry: this.retry,
      })
      socket.connect(this.options)
    } catch (error) {
      this.logger.error('FreeSwitchClient::connect: socket.connect error', {
        error,
      })
    }
  }

  /**
   * Close the current connection to FreeSwitch and stop attempting to reconnect
   */
  end(): void {
    this.logger.debug('FreeSwitchClient::end: end requested by application.', {
      attempt: this.attempt,
    })
    this.emit('end', undefined)
    this.running = false
    if (this.current_call != null) {
      this.current_call.end('End requested by application')
      this.current_call = undefined
    }
  }
}
