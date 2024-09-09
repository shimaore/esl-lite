// Response and associated API
// ===========================
import {
  AbortSignalEventEmitter,
  FreeSwitchEventEmitter,
} from './event-emitter.js'

import { ulid } from 'ulidx'

import {
  FreeSwitchParser,
  FreeSwitchParserNonEmptyBufferAtEndError,
} from './parser.js'
import { type Headers } from './headers.js'

import { type Socket } from 'node:net'
import { type EventName, isEventName } from './event-names.js'
import { type JSONValue } from './json-value.js'
import { Body } from './body.js'

// @ts-expect-error @types/node does not know that JSON.parse accepts Buffer.
const jsonParseBuffer = (b: Buffer): JSONValue => JSON.parse(b) as JSONValue

/**
 * Type for a logger for the `FreeSwitchResponse` class
 *
 * This is a specialized logger type.
 */
export type ResponseLogger = (
  msg: string,
  data: { ref: string; [key: string]: unknown }
) => void

/**
 * An object containing JSON values
 */
export type JSONMap = Record<string, JSONValue>

/**
 * An object containing simple JSON values
 */
export type ValueMap = Record<string, string | number | boolean | undefined>

/**
 * Parse a non-JSON event body received from FreeSwitch
 */
export const parseBody = function (bodyBuffer: Buffer): Body {
  const bodyLines = bodyBuffer.toString('utf8').split('\n')
  const body = new Body({})
  for (const line of bodyLines) {
    const [name, value] = line.split(/: /, 2)
    if (name != null && value != null) {
      body.set(name, value)
    }
  }
  return body
}

/**
 * Specialized loggers for FreeSwitchResponse
 */
export interface FreeSwitchResponseLogger {
  debug: ResponseLogger
  info: ResponseLogger
  error: ResponseLogger
}

/**
 * Error: un-supported Content-Type in event
 */
export class FreeSwitchUnhandledContentTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`FreeSwitchUnhandledContentTypeError: ${contentType}`)
  }
}

/**
 * Error: missing Content-Type header in event
 */
export class FreeSwitchMissingContentTypeError extends Error {
  constructor(
    public readonly headers: Headers,
    public readonly body: Buffer
  ) {
    super('FreeSwitchMissingContentTypeError')
  }
}

/**
 * Error: event body is invalid
 */
export class FreeSwitchInvalidBodyError extends Error {
  constructor(public readonly body: string) {
    super('FreeSwitchInvalidBodyError')
  }
}

/**
 * Error: event name is missing in event headers
 */
export class FreeSwitchMissingEventNameError extends Error {
  constructor(
    public readonly headers: Headers,
    public readonly body: Buffer
  ) {
    super('FreeSwitchMissingEventNameError ')
  }
}

/**
 * Error: timeout occurred
 */
export class FreeSwitchTimeoutError extends Error {
  constructor(
    public readonly timeout: number,
    public readonly text: string
  ) {
    super(`FreeSwitchTimeout: Timeout after ${timeout}ms waiting for ${text}`)
  }
}

/**
 * Error: connection with FreeSwitch was closed
 */
export class FreeSwitchClosedError extends Error {
  constructor(public readonly when: string) {
    super(`FreeSwitchClosedError: socket closed ${when}`)
  }
}

/**
 * Error: response from FreeSwitch does not contain a proper reply
 */
export class FreeSwitchNoReplyError extends Error {
  constructor(public readonly command: string) {
    super('FreeSwitchNoReplyError: no reply')
  }
}

/**
 * Error: command failed
 */
export class FreeSwitchFailedCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly response: string
  ) {
    super('FreeSwitchFailedCommandError: command failed')
  }
}

/**
 * Error: operation was canceled
 */
export class FreeSwitchAbortError extends Error {
  constructor() {
    super('FreeSwitchAbortError: operation was canceled')
  }
}

/**
 * Error: socket was ended
 */
export class FreeSwitchEndReason extends Error {
  constructor(reason: string) {
    super(`FreeSwitchEndReason: ${reason}`)
  }
}

/**
 * Response received from FreeSwitch, including headers and body
 */
export interface FreeSwitchEventData {
  /** Headers */
  headers: Headers
  /** Body */
  body: Body
}

/**
 * Response received from FreeSwitch, with only the headers parsed
 */
export interface FreeSwitchParserData {
  headers: Headers
  body: Buffer
}

/**
 * Type returned by most APIs in FreeSwitchResponse
 */
export type SendResult = Promise<
  | FreeSwitchEventData
  | FreeSwitchClosedError
  | FreeSwitchNoReplyError
  | FreeSwitchFailedCommandError
  | FreeSwitchTimeoutError
  | FreeSwitchAbortError
>

/**
 * Parser events
 */
export interface FreeSwitchParserEvents {
  // Not listing internally-processed events.
  // May also receive `freeswitch_<contentType>` — these are errors, though,
  // we should support all content-types reported by mod_event_socket at this
  // time.

  /**
   * Emitted when the parser encountered an error
   */
  error: (
    err:
      | FreeSwitchMissingContentTypeError
      | FreeSwitchUnhandledContentTypeError
      | SyntaxError
      | FreeSwitchInvalidBodyError
      | FreeSwitchMissingEventNameError
      | FreeSwitchParserNonEmptyBufferAtEndError
  ) => void

  /**
   * Emitted when Event Socket emitted log data
   */
  freeswitch_log_data: (data: FreeSwitchParserData) => void
}

/**
 * Socket events
 */
export interface FreeSwitchSocketEvents {
  /** The underlying socket was closed.
   * This event is handled by FreeSwitchResponse.
   */
  close: (err: FreeSwitchClosedError) => void
  /** The underlying socket was in error.
   * This event is handled by FreeSwitchResponse.
   */
  error: (err: Error) => void
  /** An error occurred while writing on the socket.
   * This event is handled by FreeSwitchResponse.
   */
  write: (err: Error) => void
  /** The `end()` method was called.
   * This event is handled by FreeSwitchResponse.
   */
  end: (err: FreeSwitchEndReason) => void
}

/**
 * Events private to the FreeSwitchResponse class
 */
export interface FreeSwitchPrivateEvents {
  /** FreeSwitch sends an authentication request when a client connect to the Event Socket.
   * Caught by the client code, there is no need for application code to monitor this event.
   */
  freeswitch_auth_request: (data: FreeSwitchParserData) => void
  /** Commands trigger this type of event when they are submitted.
   * Caught by `send`, there is no need for application code to monitor this event.
   */
  freeswitch_command_reply: (data: FreeSwitchParserData) => void
  /** FreeSwitch's indication that it is disconnecting the socket.
   * Caught by the client code, there is no need for application code to monitor this event.
   */
  freeswitch_disconnect_notice: (data: FreeSwitchParserData) => void
}

/**
 * Type definitions for all FreeSwitch events.
 *
 * Note: one must call the `.event_json()` method in order for events to start.
 * In other words, calling `service.on(event,…)`, `service.once(event,…)` will
 * not work unless reception of the `event` was requested using `event_json`.
 *
 * ```ts
 *   service.event_json(['CHANNEL_CREATE'])
 *
 *   service.on('CHANNEL_CREATE', function (msg) {
 *     // Handle the new call
 *   }
 * ```
 */
export interface FreeSwitchPublicResponseEvents {
  /** Receive CUSTOM events without subclasses (not useful for FreeSwitch events) */
  CUSTOM: (data: FreeSwitchEventData) => void
  CLONE: (data: FreeSwitchEventData) => void
  CHANNEL_CREATE: (data: FreeSwitchEventData) => void
  CHANNEL_DESTROY: (data: FreeSwitchEventData) => void
  CHANNEL_STATE: (data: FreeSwitchEventData) => void
  CHANNEL_CALLSTATE: (data: FreeSwitchEventData) => void
  CHANNEL_ANSWER: (data: FreeSwitchEventData) => void
  CHANNEL_HANGUP: (data: FreeSwitchEventData) => void
  CHANNEL_HANGUP_COMPLETE: (data: FreeSwitchEventData) => void
  CHANNEL_EXECUTE: (data: FreeSwitchEventData) => void
  CHANNEL_EXECUTE_COMPLETE: (data: FreeSwitchEventData) => void
  CHANNEL_HOLD: (data: FreeSwitchEventData) => void
  CHANNEL_UNHOLD: (data: FreeSwitchEventData) => void
  CHANNEL_BRIDGE: (data: FreeSwitchEventData) => void
  CHANNEL_UNBRIDGE: (data: FreeSwitchEventData) => void
  CHANNEL_PROGRESS: (data: FreeSwitchEventData) => void
  CHANNEL_PROGRESS_MEDIA: (data: FreeSwitchEventData) => void
  CHANNEL_OUTGOING: (data: FreeSwitchEventData) => void
  CHANNEL_PARK: (data: FreeSwitchEventData) => void
  CHANNEL_UNPARK: (data: FreeSwitchEventData) => void
  CHANNEL_APPLICATION: (data: FreeSwitchEventData) => void
  CHANNEL_ORIGINATE: (data: FreeSwitchEventData) => void
  CHANNEL_UUID: (data: FreeSwitchEventData) => void
  API: (data: FreeSwitchEventData) => void
  LOG: (data: FreeSwitchEventData) => void
  INBOUND_CHAN: (data: FreeSwitchEventData) => void
  OUTBOUND_CHAN: (data: FreeSwitchEventData) => void
  STARTUP: (data: FreeSwitchEventData) => void
  SHUTDOWN: (data: FreeSwitchEventData) => void
  PUBLISH: (data: FreeSwitchEventData) => void
  UNPUBLISH: (data: FreeSwitchEventData) => void
  TALK: (data: FreeSwitchEventData) => void
  NOTALK: (data: FreeSwitchEventData) => void
  SESSION_CRASH: (data: FreeSwitchEventData) => void
  MODULE_LOAD: (data: FreeSwitchEventData) => void
  MODULE_UNLOAD: (data: FreeSwitchEventData) => void
  DTMF: (data: FreeSwitchEventData) => void
  MESSAGE: (data: FreeSwitchEventData) => void
  PRESENCE_IN: (data: FreeSwitchEventData) => void
  NOTIFY_IN: (data: FreeSwitchEventData) => void
  PRESENCE_OUT: (data: FreeSwitchEventData) => void
  PRESENCE_PROBE: (data: FreeSwitchEventData) => void
  MESSAGE_WAITING: (data: FreeSwitchEventData) => void
  MESSAGE_QUERY: (data: FreeSwitchEventData) => void
  ROSTER: (data: FreeSwitchEventData) => void
  CODEC: (data: FreeSwitchEventData) => void
  BACKGROUND_JOB: (data: FreeSwitchEventData) => void
  DETECTED_SPEECH: (data: FreeSwitchEventData) => void
  DETECTED_TONE: (data: FreeSwitchEventData) => void
  PRIVATE_COMMAND: (data: FreeSwitchEventData) => void
  HEARTBEAT: (data: FreeSwitchEventData) => void
  TRAP: (data: FreeSwitchEventData) => void
  ADD_SCHEDULE: (data: FreeSwitchEventData) => void
  DEL_SCHEDULE: (data: FreeSwitchEventData) => void
  EXE_SCHEDULE: (data: FreeSwitchEventData) => void
  RE_SCHEDULE: (data: FreeSwitchEventData) => void
  RELOADXML: (data: FreeSwitchEventData) => void
  NOTIFY: (data: FreeSwitchEventData) => void
  PHONE_FEATURE: (data: FreeSwitchEventData) => void
  PHONE_FEATURE_SUBSCRIBE: (data: FreeSwitchEventData) => void
  SEND_MESSAGE: (data: FreeSwitchEventData) => void
  RECV_MESSAGE: (data: FreeSwitchEventData) => void
  REQUEST_PARAMS: (data: FreeSwitchEventData) => void
  CHANNEL_DATA: (data: FreeSwitchEventData) => void
  GENERAL: (data: FreeSwitchEventData) => void
  COMMAND: (data: FreeSwitchEventData) => void
  SESSION_HEARTBEAT: (data: FreeSwitchEventData) => void
  CLIENT_DISCONNECTED: (data: FreeSwitchEventData) => void
  SERVER_DISCONNECTED: (data: FreeSwitchEventData) => void
  SEND_INFO: (data: FreeSwitchEventData) => void
  RECV_INFO: (data: FreeSwitchEventData) => void
  RECV_RTCP_MESSAGE: (data: FreeSwitchEventData) => void
  SEND_RTCP_MESSAGE: (data: FreeSwitchEventData) => void
  CALL_SECURE: (data: FreeSwitchEventData) => void
  NAT: (data: FreeSwitchEventData) => void
  RECORD_START: (data: FreeSwitchEventData) => void
  RECORD_STOP: (data: FreeSwitchEventData) => void
  PLAYBACK_START: (data: FreeSwitchEventData) => void
  PLAYBACK_STOP: (data: FreeSwitchEventData) => void
  CALL_UPDATE: (data: FreeSwitchEventData) => void
  FAILURE: (data: FreeSwitchEventData) => void
  SOCKET_DATA: (data: FreeSwitchEventData) => void
  MEDIA_BUG_START: (data: FreeSwitchEventData) => void
  MEDIA_BUG_STOP: (data: FreeSwitchEventData) => void
  CONFERENCE_DATA_QUERY: (data: FreeSwitchEventData) => void
  CONFERENCE_DATA: (data: FreeSwitchEventData) => void
  CALL_SETUP_REQ: (data: FreeSwitchEventData) => void
  CALL_SETUP_RESULT: (data: FreeSwitchEventData) => void
  CALL_DETAIL: (data: FreeSwitchEventData) => void
  DEVICE_STATE: (data: FreeSwitchEventData) => void
  TEXT: (data: FreeSwitchEventData) => void
  SHUTDOWN_REQUESTED: (data: FreeSwitchEventData) => void
  ALL: (data: FreeSwitchEventData) => void
}

/**
 * The client will provide a FreeSwitchResponse object when it connects
 *
 * ```ts
 * const client = new FreeSwitchClient()
 *
 * client.on('connect', (service:FreeSwitchResponse) : void => {
 *   …
 * }
 * ```
 *
 * This class implements low-level APIs for FreeSwich, plus a couple
 * higher-level ones (`bgapi`, `command_uuid`) suitable for use in
 * application code.
 */
export class FreeSwitchResponse extends FreeSwitchEventEmitter<
  keyof FreeSwitchPublicResponseEvents,
  FreeSwitchPublicResponseEvents
> {
  public closed = true
  public initialized = false

  /** Uniquely identify each instance, for tracing purposes. */
  private readonly __ref: string = ulid()
  private readonly __socket: Socket
  private readonly logger: FreeSwitchResponseLogger
  private __queue: Promise<true>
  private readonly errorSignal: AbortSignalEventEmitter

  private readonly socketEventEmitter: FreeSwitchEventEmitter<
    keyof FreeSwitchSocketEvents,
    FreeSwitchSocketEvents
  >

  private readonly privateEventEmitter: FreeSwitchEventEmitter<
    keyof FreeSwitchPrivateEvents,
    FreeSwitchPrivateEvents
  >

  public readonly parserEventEmitter: FreeSwitchEventEmitter<
    keyof FreeSwitchParserEvents,
    FreeSwitchParserEvents
  >

  /** Statistics about this connection */
  public stats: {
    /**
     * Number of missing Content-Type headers
     */
    missing_contentType: bigint
    /**
     * Number of missing Event-Name headers
     */
    missing_event_name: bigint
    /**
     * Number of authentication requests
     */
    auth_request: bigint
    /**
     * Number of command replies
     */
    command_reply: bigint
    /**
     * Number of FreeSwitch events received
     */
    events: bigint
    /**
     * Number of JSON parse errors (in body)
     */
    json_parse_errors: bigint
    /**
     * Number of log data events received
     */
    log_data: bigint
    /**
     * Number of disconnect event received
     */
    disconnect: bigint
    /**
     * Number of api responses
     */
    api_responses: bigint
    /**
     * Number of rude rejections (generally due to ACL access to the Event Socket)
     */
    rude_rejections: bigint
    /**
     * Number of unhandled events
     */
    unhandled: bigint
    /**
     * Number of unflushed writes, indicating the network or FreeSwitch are not keeping up with our traffic
     */
    unflushedWrites: bigint
  } = {
    missing_contentType: 0n,
    missing_event_name: 0n,
    auth_request: 0n,
    command_reply: 0n,
    events: 0n,
    json_parse_errors: 0n,
    log_data: 0n,
    disconnect: 0n,
    api_responses: 0n,
    rude_rejections: 0n,
    unhandled: 0n,
    unflushedWrites: 0n,
  }

  /** Event emitter for custom events
   *
   * ```
   * this.custom.on('conference::maintenance', (data) => {
   * })
   * ```
   */
  public readonly custom: FreeSwitchEventEmitter<
    string,
    Record<string, (data: FreeSwitchEventData) => void>
  >

  /** The `FreeSwitchResponse` is bound to a single socket (dual-stream). */
  constructor(socket: Socket, logger: FreeSwitchResponseLogger) {
    super(
      (event: EventName) => {
        this.event_json(event)
      }
      // (event:EventName) => { this.nixevent(event) },
    )
    this.custom = new FreeSwitchEventEmitter((subclass: string) => {
      this.event_json_custom(subclass)
    })

    socket.setKeepAlive(true)
    socket.setNoDelay(true)

    this.__socket = socket
    this.logger = logger
    this.errorSignal = new FreeSwitchEventEmitter()
    this.socketEventEmitter = new FreeSwitchEventEmitter()
    this.privateEventEmitter = new FreeSwitchEventEmitter()
    this.parserEventEmitter = new FreeSwitchEventEmitter()

    // The object also provides a queue for operations which need to be submitted one after another on a given socket because FreeSwitch does not provide ways to map event socket requests and responses in the general case.
    this.__queue = Promise.resolve(true)
    // The object also provides a mechanism to report events that might already have been triggered.
    // We also must track connection close in order to prevent writing to a closed socket.
    this.closed = false

    this.privateEventEmitter.once('freeswitch_disconnect_notice', () => {
      this.end('Received disconnect notice')
    })

    // The parser is responsible for de-framing messages coming from FreeSwitch and splitting it into headers and a body.
    // We then process those in order to generate higher-level events.
    FreeSwitchParser(this.__socket, (headers: Headers, body: Buffer) => {
      ;(async () => {
        this.process(headers, body)
      })().catch((err) => {
        this.logger.error('process failed', { err, ref: this.ref() })
      })
    }).then(
      (outcome) => {
        if (outcome instanceof FreeSwitchParserNonEmptyBufferAtEndError) {
          this.parserEventEmitter.emit('error', outcome)
        }
        this.logger.info('Parser terminated', { ref: this.ref() })
      },
      (err: unknown) => {
        this.logger.error('Parser crashed', { err, ref: this.ref() })
      }
    )

    // After the socket is closed or errored, this object is no longer usable.
    const onceSocketStar = (reason?: string | Error): void => {
      this.logger.debug('FreeSwitchResponse: Terminate', {
        ref: this.__ref,
        reason,
      })
      if (!this.closed) {
        this.closed = true
        this.__socket.end()
      }
      this.errorSignal.emit('abort', undefined)
      this.removeAllListeners()
      this.__queue = Promise.resolve(true)
    }
    this.socketEventEmitter.once('error', onceSocketStar)
    this.socketEventEmitter.once('close', onceSocketStar)
    this.socketEventEmitter.once('write', onceSocketStar)
    this.socketEventEmitter.once('end', onceSocketStar)

    /* Event handlers for the underlying socket */
    const socketOnceCclose = (hadError: boolean): void => {
      this.logger.debug('FreeSwitchResponse: Socket closed', {
        ref: this.__ref,
      })
      this.socketEventEmitter.emit(
        'close',
        new FreeSwitchClosedError(hadError ? 'on error' : 'on close')
      )
    }
    this.__socket.once('close', socketOnceCclose)

    // Default handler for `error` events to prevent `Unhandled 'error' event` reports.
    const socketOnError = (err: Error): void => {
      this.logger.debug('FreeSwitchResponse: Socket Error', {
        ref: this.__ref,
        error: err,
      })
      this.socketEventEmitter.emit('error', err)
    }
    this.__socket.on('error', socketOnError)
  }

  /**
   *  init() — internal method
   *
   *  This method is called automatically by FreeSwitchClient after authorization.
   *  It initializes the connection with FreeSwitch.
   */
  init(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true

    this.on('CHANNEL_EXECUTE_COMPLETE', (res: FreeSwitchEventData) => {
      const eventUUID = res.body.applicationUUID
      if (eventUUID != null) {
        const resolver = this.executeCompleteMap.get(eventUUID)
        if (resolver != null) {
          this.executeCompleteMap.delete(eventUUID)
          this.logger.debug('FreeSwitchResponse: CHANNEL_EXECUTE_COMPLETE', {
            eventUUID,
            ref: this.__ref,
          })
          resolver(res)
        }
      }
    })

    this.on('BACKGROUND_JOB', (res: FreeSwitchEventData) => {
      const jobUUID = res.body.jobUUID
      if (jobUUID != null) {
        const resolver = this.backgroundJobMap.get(jobUUID)
        if (resolver != null) {
          this.backgroundJobMap.delete(jobUUID)
          this.logger.debug('FreeSwitchResponse: BACKGROUND_JOB', {
            jobUUID,
            ref: this.__ref,
          })
          resolver(res)
        }
      }
    })

    this.on('CUSTOM', (res) => {
      const subclass = res.body.data['Event-Subclass']
      if (typeof subclass === 'string') {
        this.custom.emit(subclass, res)
      }
    })
  }

  /**
   * Unique identifier for this FreeSwitchResponse, used e.g. in the logger
   */
  ref(): string {
    return this.__ref
  }

  /**
   * End this FreeSwichResponse, closing the underlying socket.
   */
  end(reason: string): void {
    this.socketEventEmitter.emit('end', new FreeSwitchEndReason(reason))
  }

  private async awaitSignal<T>(
    timeout: number,
    signal: AbortSignalEventEmitter,
    handler: (resolve: (v: T) => void) => () => void
  ): Promise<
    T | FreeSwitchClosedError | FreeSwitchTimeoutError | FreeSwitchAbortError
  > {
    return await new Promise((resolve) => {
      if (this.closed) {
        resolve(new FreeSwitchClosedError('before waiting'))
        return
      }

      const timeoutHandler = (): void => {
        // clearTimeout(timer)
        this.errorSignal.removeListener('abort', errorAbortHandler)
        signal.removeListener('abort', signalAbortHandler)
        canceler()
        resolve(new FreeSwitchTimeoutError(timeout, 'awaitSignal'))
      }

      const errorAbortHandler = (): void => {
        clearTimeout(timer)
        // this.errorSignal.removeListener('abort', errorAbortHandler)
        signal.removeListener('abort', signalAbortHandler)
        canceler()
        resolve(new FreeSwitchClosedError('while waiting'))
      }

      const signalAbortHandler = (): void => {
        clearTimeout(timer)
        this.errorSignal.removeListener('abort', errorAbortHandler)
        // signal.removeListener('abort', signalAbortHandler)
        canceler()
        resolve(new FreeSwitchAbortError())
      }

      const successHandler = (v: T): void => {
        clearTimeout(timer)
        this.errorSignal.removeListener('abort', errorAbortHandler)
        signal.removeListener('abort', signalAbortHandler)
        // canceler()
        resolve(v)
      }

      const timer = setTimeout(timeoutHandler, timeout)
      this.errorSignal.once('abort', errorAbortHandler)
      signal.once('abort', signalAbortHandler)
      const canceler = handler(successHandler)
    })
  }

  private readonly executeCompleteMap = new Map<
    string,
    (res: FreeSwitchEventData) => void
  >()

  private async awaitExecuteComplete(
    eventUUID: string,
    timeout: number,
    signal: AbortSignalEventEmitter
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchClosedError
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
  > {
    const p = this.awaitSignal<FreeSwitchEventData>(
      timeout,
      signal,
      (resolve) => {
        this.executeCompleteMap.set(eventUUID, resolve)
        return () => {
          this.executeCompleteMap.delete(eventUUID)
        }
      }
    )
    return await p
  }

  private readonly backgroundJobMap = new Map<
    string,
    (res: FreeSwitchEventData) => void
  >()

  private async awaitBackgroundJob(
    jobUUID: string,
    timeout: number,
    signal: AbortSignalEventEmitter
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchClosedError
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
  > {
    const p = this.awaitSignal<FreeSwitchEventData>(
      timeout,
      signal,
      (resolve) => {
        this.backgroundJobMap.set(jobUUID, resolve)
        return () => {
          this.backgroundJobMap.delete(jobUUID)
        }
      }
    )
    return await p
  }

  /**
   * (internal) Promise for private event
   */
  async oncePrivateAsync(
    event: keyof FreeSwitchPrivateEvents,
    timeout: number,
    signal: AbortSignalEventEmitter
  ): Promise<
    | FreeSwitchParserData
    | FreeSwitchClosedError
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
  > {
    const p = this.awaitSignal<FreeSwitchParserData>(
      timeout,
      signal,
      (resolve) => {
        this.privateEventEmitter.once(event, resolve)
        return () => {
          this.privateEventEmitter.removeListener(event, resolve)
        }
      }
    )
    return await p
  }

  /** (internal) Enqueue a function that returns a Promise.
   *
   * The function is only called when all previously enqueued functions-that-return-Promises are completed and their respective Promises fulfilled or rejected.
   */
  private async enqueue<T>(
    f: () => Promise<T>
  ): Promise<T | FreeSwitchClosedError> {
    if (this.closed) {
      return new FreeSwitchClosedError('enqueuing')
    }
    const q = this.__queue
    const next = (async function () {
      await q
      return await f()
    })()
    this.__queue = next.then(
      () => true,
      () => true
    )
    return await next
  }

  /**
   * Send a single command to FreeSwitch; `args` is a hash of headers sent with the command.
   *
   * This is a low-level method; in most cases one should use `bgapi`, `command_uuid`, etc
   * which provide higher-level APIs.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async write(
    command: string,
    headers: ValueMap
  ): Promise<null | FreeSwitchClosedError> {
    if (this.closed) {
      return new FreeSwitchClosedError('before writing')
    }
    const writeHandler = (
      resolve: (v: null) => void,
      reject: (error: unknown) => void
    ): void => {
      try {
        let text = `${command}\n`
        for (const key of Object.getOwnPropertyNames(headers)) {
          const value = headers[key]
          if (value != null) {
            switch (typeof value) {
              case 'string':
                text += `${key}: ${value}\n`
                break
              case 'number':
                text += `${key}: ${value.toString(10)}\n`
                break
              case 'boolean':
                text += `${key}: ${value ? 'true' : 'false'}\n`
                break
            }
          }
        }
        text += '\n'
        this.logger.debug('FreeSwitchResponse: write', {
          ref: this.__ref,
          text,
        })
        const flushed = this.__socket.write(text, 'utf8')
        if (!flushed) {
          this.stats.unflushedWrites++
          this.__socket.once('drain', resolve)
        } else {
          process.nextTick(resolve)
        }
      } catch (error) {
        this.logger.error('FreeSwitchResponse: write error', {
          ref: this.__ref,
          command,
          headers,
          error,
        })
        if (error instanceof Error) {
          this.socketEventEmitter.emit('write', error)
        } else {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          this.socketEventEmitter.emit('write', new Error(`${error}`))
        }
        reject(error)
      }
    }
    return await new Promise(writeHandler)
  }

  /**
   * A generic way of sending commands to FreeSwitch, wrapping `write` into a Promise that waits for FreeSwitch's notification that the command completed.
   *
   * This is a low-level method; in most cases one should use `bgapi`, `command_uuid`, etc
   * which provide higher-level APIs.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async send(
    command: string,
    commandHeaders: ValueMap,
    timeout: number
  ): SendResult {
    if (this.closed) {
      return new FreeSwitchClosedError('before sending')
    }
    // Typically `command/reply` will contain the status in the `Reply-Text` header while `api/response` will contain the status in the body.
    const sendHandler = async (): Promise<
      | FreeSwitchEventData
      | FreeSwitchNoReplyError
      | FreeSwitchFailedCommandError
      | FreeSwitchClosedError
      | FreeSwitchTimeoutError
      | FreeSwitchAbortError
    > => {
      const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
      const p = this.oncePrivateAsync(
        'freeswitch_command_reply',
        timeout,
        signal
      )
      const q = await this.write(command, commandHeaders)
      if (q instanceof Error) {
        signal.emit('abort', undefined)
        return q
      }
      const value = await p
      if (value instanceof Error) {
        return value
      }

      const { headers, body } = value
      this.logger.debug('FreeSwitchResponse: send: received reply', {
        ref: this.__ref,
        command,
        commandHeaders,
        headers,
        body,
      })
      const reply = headers.replyText
      // The Promise might fail if FreeSwitch's notification indicates an error.
      if (reply == null) {
        return new FreeSwitchNoReplyError(command)
      }
      if (reply.startsWith('-')) {
        return new FreeSwitchFailedCommandError(command, reply)
      }

      let bodyData: JSONValue | undefined
      try {
        bodyData = jsonParseBuffer(body)
      } catch (_err) {
        bodyData = undefined
      }
      let newBody: Body
      if (
        bodyData === null ||
        typeof bodyData === 'boolean' ||
        typeof bodyData === 'number' ||
        Array.isArray(bodyData)
      ) {
        newBody = new Body({ response: bodyData })
      } else {
        newBody = new Body({ response: body.toString() })
      }

      // The promise will be fulfilled with the `{headers,body}` object provided by the parser.
      this.logger.debug('FreeSwitchResponse: send: success', {
        ref: this.__ref,
        command,
        commandHeaders,
        headers,
        bodyData,
      })

      return { headers, body: newBody }
    }
    return await this.enqueue(sendHandler)
  }

  /** (internal) Process data from the parser.
   *
   * This private method rewrites headers as needed to work around some weirdnesses in the protocol;
   * and assign unified event IDs to the Event Socket's Content-Types.
   */
  private process(headers: Headers, body: Buffer): void {
    const contentType = headers.contentType
    if (contentType == null) {
      this.stats.missing_contentType++
      this.parserEventEmitter.emit(
        'error',
        new FreeSwitchMissingContentTypeError(headers, body)
      )
      return
    }
    // Notice how all our (internal) event names are lower-cased; FreeSwitch always uses full-upper-case event names.
    switch (contentType) {
      // auth/request
      // ------------

      // FreeSwitch sends an authentication request when a client connect to the Event Socket.
      // Normally caught by the client code, there is no need for application code to monitor this event.
      case 'auth/request': {
        this.stats.auth_request++
        this.privateEventEmitter.emit('freeswitch_auth_request', {
          headers,
          body,
        })
        return
      }

      // command/reply
      // -------------

      // Commands trigger this type of event when they are submitted.
      // Normally caught by `send`, there is no need for application code to monitor this event.
      case 'command/reply': {
        this.stats.command_reply++
        this.privateEventEmitter.emit('freeswitch_command_reply', {
          headers,
          body,
        })
        return
      }

      // text/event-json
      // ---------------

      // A generic event with a JSON body. We map it to its own Event-Name.
      case 'text/event-json': {
        this.stats.events++
        let bodyValues: JSONValue = null
        // Strip control characters that might be emitted by FreeSwitch.
        // body = body.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        try {
          // Parse the JSON body.
          bodyValues = jsonParseBuffer(body)
        } catch (exception) {
          // In case of error report it as an error.
          this.stats.json_parse_errors++
          if (exception instanceof SyntaxError) {
            this.parserEventEmitter.emit('error', exception)
          } else {
            this.logger.error('Unknown JSON parsing error', {
              ref: this.__ref,
              err: exception,
            })
          }
          return
        }

        if (
          bodyValues == null ||
          typeof bodyValues === 'string' ||
          typeof bodyValues === 'number' ||
          typeof bodyValues === 'boolean' ||
          Array.isArray(bodyValues)
        ) {
          this.parserEventEmitter.emit(
            'error',
            new FreeSwitchInvalidBodyError(body.toString())
          )
          return
        }

        // Otherwise trigger the proper event.
        const newBody = new Body(bodyValues)
        const newEvent = newBody.eventName
        if (typeof newEvent === 'string' && isEventName(newEvent)) {
          this.emit(newEvent, { headers, body: newBody })
        } else {
          this.stats.missing_event_name++
          this.parserEventEmitter.emit(
            'error',
            new FreeSwitchMissingEventNameError(headers, body)
          )
        }
        return
      }

      // text/event-plain
      // ----------------

      // Same as `text/event-json` except the body is encoded using plain text. Either way the module provides you with a parsed body (a hash/Object).
      case 'text/event-plain': {
        this.stats.events++
        const newBody = parseBody(body)
        const newEvent = newBody.eventName
        if (newEvent != null && isEventName(newEvent)) {
          const msg = { headers, body: newBody }
          this.emit(newEvent, msg)
        } else {
          this.stats.missing_event_name++
          this.parserEventEmitter.emit(
            'error',
            new FreeSwitchMissingEventNameError(headers, body)
          )
        }
        return
      }

      // log/data
      // --------
      case 'log/data': {
        this.stats.log_data++
        this.parserEventEmitter.emit('freeswitch_log_data', { headers, body })
        return
      }

      // text/disconnect-notice
      // ----------------------

      // FreeSwitch's indication that it is disconnecting the socket.
      case 'text/disconnect-notice': {
        this.stats.disconnect++
        this.privateEventEmitter.emit('freeswitch_disconnect_notice', {
          headers,
          body,
        })
        return
      }

      // api/response
      // ------------

      // Triggered when an `api` message returns.
      // We never send `api` messages, therefor we do not expect those to come back.
      case 'api/response': {
        this.stats.api_responses++
        /* We never send those */
        this.logger.error('FreeSwitchResponse: Unexpect api/response', {
          ref: this.__ref,
          body,
        })
        return
      }

      case 'text/rude-rejection': {
        this.stats.rude_rejections++
        this.end('Received rude rejection, most probably due to ACL')
        return
      }

      default: {
        // Ideally other content-types should be individually specified. In any case we provide a fallback mechanism.
        // Others?
        // -------
        this.stats.unhandled++
        this.parserEventEmitter.emit(
          'error',
          new FreeSwitchUnhandledContentTypeError(contentType)
        )
      }
    }
  }

  /** Send an API command in the background. Wraps it inside a Promise.
   *
   * `bgapi` will return an error if the job submission fails.
   *
   * It will not return an error if the bakcground job itself failed.
   * The response from the background job will be stored in the `.body.response` field of the return value.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async bgapi(
    command: string,
    timeout: number
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchNoReplyError
    | FreeSwitchTimeoutError
    | FreeSwitchClosedError
    | FreeSwitchAbortError
  > {
    const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
    const jobUUID = ulid()
    const p = this.awaitBackgroundJob(jobUUID, timeout, signal)
    const q = await this.send(
      `bgapi ${command}`,
      { 'job-uuid': jobUUID },
      timeout
    )
    if (q instanceof Error) {
      signal.emit('abort', undefined)
      return q
    }
    return await p
  }

  /**
   * Request that the server adds the events to its filter, and provide them in JSON format.
   * ```ts
   * await service.event_json('HEARTBEAT')
   * ```
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  private event_json(event: EventName): void {
    this.send(`event json ${event}`, {}, this.localTimeout).catch(
      (err: unknown) => {
        this.logger.error('event_json', { ref: this.ref(), err })
      }
    )
  }

  /**
   * Request that the server adds the CUSTOM event to its filter, and provide them in JSON format.
   * ```ts
   * await service.event_json_custom('conference::maintenance')
   * ```
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  private event_json_custom(subclass: string): void {
    this.send(`event json CUSTOM ${subclass} `, {}, this.localTimeout).catch(
      (err: unknown) => {
        this.logger.error('event_json_custom', { ref: this.ref(), err })
      }
    )
  }

  /**
   * Remove the given event types from the events ACL.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async nixevent(event: EventName): SendResult {
    return await this.send(`nixevent ${event}`, {}, this.localTimeout)
  }

  /**
   * Remove all events types from the filters.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async noevents(): SendResult {
    return await this.send('noevents', {}, this.localTimeout)
  }

  /**
   * Generic event filtering using header and value matching.
   *
   * This will only forward events for which the header has this value.
   *
   * This will most probably break this module's handling of background jobs etc.
   * so this is most probably _not_ what one wants in most cases.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async filter(header: string, value: string): SendResult {
    return await this.send(`filter ${header} ${value}`, {}, this.localTimeout)
  }

  /**
   * Remove a generic header-and-value filter.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async filter_delete(header: string, value: string): SendResult {
    if (value != null) {
      return await this.send(
        `filter delete ${header} ${value}`,
        {},
        this.localTimeout
      )
    } else {
      return await this.send(`filter delete ${header}`, {}, this.localTimeout)
    }
  }

  /**
   * Send an event into the FreeSwitch event queue.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async sendevent(eventName: EventName, args: ValueMap): SendResult {
    return await this.send(
      `sendevent ${eventName}`,
      { 'Event-Name': eventName, ...args },
      this.localTimeout
    )
  }

  /**
   * Used internally.
   * Calling this method is normally not needed since the module authenticates automatically when requested.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async auth(password: string): SendResult {
    return await this.send(`auth ${password}`, {}, this.localTimeout)
  }

  /**
   * Enable logging on the socket, optionally setting the log level.
   *
   * The logs will be published using the `freeswitch_log_data` event name:
   * ```
   * service.on('freeswitch_log_data', (data) => { … })
   * ```
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async log(level: number): SendResult {
    if (level != null) {
      return await this.send(`log ${level}`, {}, this.localTimeout)
    } else {
      return await this.send('log', {}, this.localTimeout)
    }
  }

  /**
   * Disable logging on the socket.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async nolog(): SendResult {
    return await this.send('nolog', {}, this.localTimeout)
  }

  /**
   * Send a message to a given UUID (channel).
   *
   * This is a low-level operation; in most cases `execute_uuid`, `command_uuid` etc
   * will provide a better API.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async sendmsg_uuid(
    uuid: string,
    command: string,
    args: ValueMap
  ): SendResult {
    const options = { ...args, 'call-command': command }
    // alternatively, `uuid` might be specified as header `session-id`
    const executeText = `sendmsg ${uuid}`
    return await this.send(executeText, options, this.localTimeout)
  }

  // Client-mode ("inbound") commands
  // =================================

  // The target UUID must be specified.

  // execute_uuid
  // ------------

  /**
   * Execute an application for the given UUID (channel). Does not await the result.
   * `event-uuid` and `event-uuid-name` are set as `app_uuid` and `app_uuid_name` in the channel, respectively.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async execute_uuid(
    uuid: string,
    appName: string,
    appArg: string,
    headers?: {
      'event-uuid'?: string
      'event-uuid-name'?: string
      'content-type'?: string
      loops?: number
      'hold-bleg'?: boolean
    }
  ): SendResult {
    const options = {
      ...headers,
      'execute-app-name': appName,
      'execute-app-arg': appArg,
    }
    return await this.sendmsg_uuid(uuid, 'execute', options)
  }

  // TODO: Support the alternate format (with no `execute-app-arg` header but instead a `text/plain` body containing the argument).

  /**
   * Execute an application synchronously.
   *
   * Check the result's `response` field to know the outcome of a command.
   * The first character indicates success (`+`) or failure (`-`).
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async command_uuid(
    uuid: string,
    appName: string,
    appArg = '',
    timeout: number
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchClosedError
    | FreeSwitchNoReplyError
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
  > {
    const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
    const eventUUID: string = ulid()
    const p = this.awaitExecuteComplete(eventUUID, timeout, signal)
    const q = await this.execute_uuid(uuid, appName, appArg, {
      'event-uuid': eventUUID,
    })
    if (q instanceof Error) {
      signal.emit('abort', undefined)
      return q
    }
    return await p
  }

  // hangup_uuid
  // -----------

  /**
   * Hangup the call referenced by the given UUID with an optional (FreeSwitch) cause code.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async hangup_uuid(uuid: string, hangupCause?: string): SendResult {
    if (hangupCause == null) {
      hangupCause = 'NORMAL_UNSPECIFIED'
    }
    const options = {
      'hangup-cause': hangupCause,
    }
    return await this.sendmsg_uuid(uuid, 'hangup', options)
  }

  // unicast_uuid
  // ------------

  /**
   * Forwards the media to and from a given socket.
   *
   *
   * This method is not expected to throw / return a rejected Promise.
   */

  // Arguments:
  // - `local-ip`
  // - `local-port`
  // - `remote-ip`
  // - `remote-port`
  // - `transport` (`tcp` or `udp`)
  // - `flags: "native"` (optional: do not transcode to/from L16 audio)
  async unicast_uuid(
    uuid: string,
    args: {
      'local-ip': string
      'local-port': number
      'remote-ip': string
      'remote-port': number
      transport: 'tcp' | 'udp'
      /**
       * native means do not transcode to/from L16 audio
       *
       * In other words, if the flags is present, audio will be in the native codec.
       * If the flag is absent, audio will be in L16 format.
       */
      flags?: 'native'
    }
  ): SendResult {
    const options = {
      ...args,
      'local-port': args['local-port'].toString(10),
      'remote-port': args['remote-port'].toString(10),
    } as const
    return await this.sendmsg_uuid(uuid, 'unicast', options)
  }

  // nomedia_uuid
  // ------------

  // Not implemented yet (TODO).

  // switch_ivr.c also lists `xferext` in `switch_ivr_parse_event`.

  localTimeout = 1_000
}
