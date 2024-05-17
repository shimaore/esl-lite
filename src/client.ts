// Client
// ======

// Client mode is used to place new calls or take over existing calls.
// Contrarily to the server which will handle multiple socket connections over its lifetime, a client only handles one socket, so only one `FreeSwitchResponse` object is needed as well.

import { Socket } from 'node:net'

import { FreeSwitchEventEmitter } from './event-emitter.js'

import { FreeSwitchResponse } from './response.js'
import { type FreeSwitchParserNonEmptyBufferAtEndError } from './parser.js'

const defaultPassword = 'ClueCon'

type Logger = (msg: string, data?: unknown) => void

export interface FreeSwitchClientLogger {
  debug: Logger
  info: Logger
  error: Logger
}

interface FreeSwitchClientEvents {
  connect: (call: FreeSwitchResponse) => void
  error: (error: unknown) => void
  warning: (data: FreeSwitchParserNonEmptyBufferAtEndError) => void
  reconnecting: (retry_timeout: number) => void
  end: () => void
}

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
  private running: boolean = true
  private retry: number = 200
  private attempt: bigint = 0n
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
    port: number
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
      const signal = new FreeSwitchEventEmitter()
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
        signal.emit('abort')
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

    this.current_call.parserEventEmitter.once(
      'error.buffer-not-empty-at-end',
      (data: FreeSwitchParserNonEmptyBufferAtEndError) => {
        this.emit('warning', data)
      }
    )

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

  end(): void {
    this.logger.debug('FreeSwitchClient::end: end requested by application.', {
      attempt: this.attempt,
    })
    this.emit('end')
    this.running = false
    if (this.current_call != null) {
      this.current_call.end('End requested by application')
      this.current_call = undefined
    }
  }
}
