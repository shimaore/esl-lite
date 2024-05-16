// Response and associated API
// ===========================
import { FreeSwitchEventEmitter } from './event-emitter.js'

import { ulid } from 'ulidx'

import { FreeSwitchParser } from './parser.js'
import { type Headers } from './headers.js'

import { type Socket } from 'node:net'
import { type EventName, isEventName } from './event-names.js'
import { type JSONValue } from './json-value.js'
import { Body } from './body.js'

// @ts-expect-error @types/node does not know that JSON.parse accepts Buffer.
const jsonParseBuffer = (b: Buffer): JSONValue => JSON.parse(b)

type ResponseLogger = (
  msg: string,
  data: { ref: string; [key: string]: unknown }
) => void

export type JSONMap = Record<string, JSONValue>
export type ValueMap = Record<string, string | number | boolean | undefined>

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

export interface FreeSwitchResponseLogger {
  debug: ResponseLogger
  info: ResponseLogger
  error: ResponseLogger
}

const asyncLog = function <T>(
  msg: string,
  ref: string,
  af: () => Promise<T>,
  logger: FreeSwitchResponseLogger
): () => Promise<T> {
  return async function () {
    return await af().catch(function (error) {
      logger.error(`FreeSwitchResponse::asyncLog: ${msg}`, { error, ref })
      throw error
    })
  }
}

export class FreeSwitchError extends Error {
  public readonly res:
    | FreeSwitchEventData
    | { headers: Headers; body: Buffer }
    | undefined

  public readonly args: Record<string, string | JSONMap | undefined>
  constructor(
    res: FreeSwitchEventData | { headers: Headers; body: Buffer } | undefined,
    args: Record<string, string | JSONMap | undefined>
  ) {
    super('FreeSwitchError')
    this.res = res
    this.args = args
  }

  override toString(): string {
    return `FreeSwitchError: ${JSON.stringify(this.args)}`
  }
}

export class FreeSwitchUnhandledContentTypeError extends Error {
  public readonly contentType: string
  constructor(contentType: string) {
    super('FreeSwitchUnhandledContentTypeError')
    this.contentType = contentType
  }

  override toString(): string {
    return `FreeSwitchUnhandledContentTypeError: ${this.contentType}`
  }
}

export class FreeSwitchMissingContentTypeError extends Error {
  public readonly headers: Headers
  public readonly body: Buffer
  constructor(headers: Headers, body: Buffer) {
    super('FreeSwitchMissingContentTypeError')
    this.headers = headers
    this.body = body
  }

  override toString(): string {
    return `FreeSwitchMissingContentTypeError: ${JSON.stringify({ headers: this.headers, body: this.body })}`
  }
}

export class FreeSwitchMissingEventNameError extends Error {
  public readonly headers: Headers
  public readonly body: Buffer
  constructor(headers: Headers, body: Buffer) {
    super('FreeSwitchMissingEventNameError ')
    this.headers = headers
    this.body = body
  }

  override toString(): string {
    return `FreeSwitchMissingEventNameError: ${JSON.stringify({ headers: this.headers, body: this.body })}`
  }
}

export class FreeSwitchTimeoutError extends Error {
  public readonly timeout: number
  public readonly text: string
  constructor(timeout: number, text: string) {
    super('FreeSwitchTimeoutError')
    this.timeout = timeout
    this.text = text
  }

  override toString(): string {
    return `FreeSwitchTimeout: Timeout after ${this.timeout}ms waiting for ${this.text}`
  }
}

export class FreeSwitchClosedError extends Error {
  constructor() {
    super('FreeSwitchClosedError')
  }

  override toString(): string {
    return 'FreeSwitchClosedError'
  }
}

export interface FreeSwitchEventData {
  /** Headers */
  headers: Headers
  /** Body */
  body: Body
}
type SendResult = Promise<FreeSwitchEventData> // or FreeSwitchError

export interface FreeSwitchResponseEvents {
  // Not listing internally-processed events.
  // May also receive `freeswitch_<contentType>` — these are errors, though,
  // we should support all content-types reported by mod_event_socket at this
  // time.

  'socket.close': (outcome: undefined) => void
  'socket.error': (err: Error) => void
  'socket.write': (err: Error) => void
  'socket.end': (err: Error) => void
  'error.missing-content-type': (err: FreeSwitchMissingContentTypeError) => void
  'error.unhandled-content-type': (
    err: FreeSwitchUnhandledContentTypeError
  ) => void
  'error.invalid-json': (err: Error) => void
  'error.missing-event-name': (err: FreeSwitchMissingEventNameError) => void
  freeswitch_log_data: (data: { headers: Headers; body: Buffer }) => void
  freeswitch_disconnect_notice: (data: {
    headers: Headers
    body: Buffer
  }) => void

  // FIXME not sure how to use EventName here
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

  /* private */
  freeswitch_auth_request: (data: { headers: Headers; body: Buffer }) => void
  freeswitch_command_reply: (data: { headers: Headers; body: Buffer }) => void
  freeswitch_api_response: (data: { headers: Headers; body: Buffer }) => void
}

interface ErrorSignalEvents {
  abort: () => void
}

type ErrorSignalEventEmitter = FreeSwitchEventEmitter<
  keyof ErrorSignalEvents,
  ErrorSignalEvents
>

export class FreeSwitchResponse extends FreeSwitchEventEmitter<
  keyof FreeSwitchResponseEvents,
  FreeSwitchResponseEvents
> {
  public closed: boolean = true

  // Uniquely identify each instance, for tracing purposes.
  private readonly __ref: string = ulid()
  private readonly __socket: Socket
  private readonly logger: FreeSwitchResponseLogger
  private __queue: Promise<true>
  private readonly errorSignal: ErrorSignalEventEmitter

  // The module provides statistics in the `stats` object if it is initialized. You may use it  to collect your own call-related statistics.
  public stats: {
    missing_contentType: bigint
    missing_event_name: bigint
    auth_request: bigint
    command_reply: bigint
    events: bigint
    json_parse_errors: bigint
    log_data: bigint
    disconnect: bigint
    api_responses: bigint
    rude_rejections: bigint
    unhandled: bigint
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

  // The `FreeSwitchResponse` is bound to a single socket (dual-stream).
  constructor(socket: Socket, logger: FreeSwitchResponseLogger) {
    super()
    socket.setKeepAlive(true)
    socket.setNoDelay(true)

    this.__socket = socket
    this.logger = logger

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
    this.once('freeswitch_disconnect_notice', () => {
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
      () => {
        this.logger.info('Parser terminated', { ref: this.ref() })
      },
      (err: any) => {
        this.logger.error('Parser crashed', { err, ref: this.ref() })
      }
    )

    // The object also provides a queue for operations which need to be submitted one after another on a given socket because FreeSwitch does not provide ways to map event socket requests and responses in the general case.
    this.__queue = Promise.resolve(true)
    // The object also provides a mechanism to report events that might already have been triggered.
    // We also must track connection close in order to prevent writing to a closed socket.
    this.closed = false

    const socketOnceCclose = (): void => {
      this.logger.debug('FreeSwitchResponse: Socket closed', {
        ref: this.__ref,
      })
      this.emit('socket.close', undefined)
    }
    this.__socket.once('close', socketOnceCclose)

    // Default handler for `error` events to prevent `Unhandled 'error' event` reports.
    const socketOnError = (err: Error): void => {
      this.logger.debug('FreeSwitchResponse: Socket Error', {
        ref: this.__ref,
        error: err,
      })
      this.emit('socket.error', err)
    }
    this.__socket.on('error', socketOnError)

    // After the socket is closed or errored, this object is no longer usable.
    this.errorSignal = new FreeSwitchEventEmitter()

    const onceSocketStar = (reason?: string | Error): void => {
      this.logger.debug('FreeSwitchResponse: Terminate', {
        ref: this.__ref,
        reason,
      })
      if (!this.closed) {
        this.closed = true
        this.__socket.end()
      }
      this.errorSignal.emit('abort')
      this.removeAllListeners()
      this.__queue = Promise.resolve(true)
    }
    this.once('socket.error', onceSocketStar)
    this.once('socket.close', onceSocketStar)
    this.once('socket.write', onceSocketStar)
    this.once('socket.end', onceSocketStar)
  }

  ref(): string {
    return this.__ref
  }

  end(reason: string): void {
    this.emit('socket.end', new Error(reason))
  }

  private async error<T>(
    res: FreeSwitchEventData | { headers: Headers; body: Buffer } | undefined,
    data: Record<string, string | JSONMap | undefined>
  ): Promise<T> {
    this.logger.error('FreeSwitchResponse: error: new FreeSwitchError', {
      ref: this.__ref,
      res,
      data,
    })
    return await Promise.reject(new FreeSwitchError(res, data))
  }

  private async awaitSignal<V>(
    timeout: number,
    handler: (resolve: (v: V) => void) => () => void
  ): Promise<V> {
    return await new Promise<V>((resolve, reject) => {
      if (this.closed) {
        reject(new FreeSwitchClosedError())
        return
      }

      const timeoutHandler = (): void => {
        this.errorSignal.removeListener('abort', abortHandler)
        canceler()
        reject(new FreeSwitchTimeoutError(timeout, 'awaitSignal'))
      }

      const abortHandler = (): void => {
        clearTimeout(timer)
        canceler()
        reject(new FreeSwitchClosedError())
      }

      const successHandler = (v: V): void => {
        clearTimeout(timer)
        this.errorSignal.removeListener('abort', abortHandler)
        resolve(v)
      }

      const timer = setTimeout(timeoutHandler, timeout)
      this.errorSignal.once('abort', abortHandler)
      const canceler = handler(successHandler)
    })
  }

  private readonly executeCompleteMap = new Map<
    string,
    (res: FreeSwitchEventData) => void
  >()

  private async awaitExecuteComplete(
    eventUUID: string,
    timeout: number
  ): Promise<FreeSwitchEventData> {
    return await this.awaitSignal<FreeSwitchEventData>(timeout, (resolve) => {
      this.executeCompleteMap.set(eventUUID, resolve)
      return () => {
        this.executeCompleteMap.delete(eventUUID)
      }
    })
  }

  private readonly backgroundJobMap = new Map<
    string,
    (res: FreeSwitchEventData) => void
  >()

  private async awaitBackgroundJob(
    jobUUID: string,
    timeout: number
  ): Promise<FreeSwitchEventData> {
    return await this.awaitSignal<FreeSwitchEventData>(timeout, (resolve) => {
      this.backgroundJobMap.set(jobUUID, resolve)
      return () => {
        this.backgroundJobMap.delete(jobUUID)
      }
    })
  }

  async onceAsync<K extends keyof FreeSwitchResponseEvents>(
    event: K,
    timeout: number
  ): Promise<Parameters<FreeSwitchResponseEvents[K]>[0]> {
    return await this.awaitSignal(timeout, (resolve) => {
      this.once(event, resolve)
      return () => {
        this.removeListener(event, resolve)
      }
    })
  }

  // Queueing
  // ========

  // Enqueue a function that returns a Promise.
  // The function is only called when all previously enqueued functions-that-return-Promises are completed and their respective Promises fulfilled or rejected.
  async enqueue<T>(f: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return await Promise.reject(new FreeSwitchClosedError())
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

  // Sync/Async event
  // ================

  // Low-level sending
  // =================

  // These methods are normally not used directly.

  // write
  // -----
  //

  // Send a single command to FreeSwitch; `args` is a hash of headers sent with the command.
  async write(command: string, headers: ValueMap): Promise<null> {
    if (this.closed) {
      return await Promise.reject(new FreeSwitchClosedError())
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
          this.logger.debug('FreeSwitchResponse: write did not flush', {
            ref: this.__ref,
            command,
            headers,
          })
        }
        resolve(null)
      } catch (error) {
        this.logger.error('FreeSwitchResponse: write error', {
          ref: this.__ref,
          command,
          headers,
          error,
        })
        // Cancel any pending Promise started with `@onceAsync`, and close the connection.
        if (error instanceof Error) {
          this.emit('socket.write', error)
        } else {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          this.emit('socket.write', new Error(`${error}`))
        }
        reject(error)
      }
    }
    return await new Promise(writeHandler)
  }

  // send
  // ----

  // A generic way of sending commands to FreeSwitch, wrapping `write` into a Promise that waits for FreeSwitch's notification that the command completed.
  async send(command: string, args: ValueMap, timeout: number): SendResult {
    if (this.closed) {
      return await Promise.reject(new FreeSwitchClosedError())
    }
    // Typically `command/reply` will contain the status in the `Reply-Text` header while `api/response` will contain the status in the body.
    const msg = `send ${command} ${JSON.stringify(args)}`
    const sendHandler = async (): Promise<FreeSwitchEventData> => {
      const p = this.onceAsync('freeswitch_command_reply', timeout)
      const q = this.write(command, args)
      const [res] = await Promise.all([p, q])
      const { headers, body } = res
      this.logger.debug('FreeSwitchResponse: send: received reply', {
        ref: this.__ref,
        command,
        args,
        headers,
        body,
      })
      const reply = headers.replyText
      // The Promise might fail if FreeSwitch's notification indicates an error.
      if (reply == null) {
        return await this.error(res, {
          when: 'no reply to command',
          command,
        })
      }
      if (reply.match(/^-/) != null) {
        return await this.error(res, {
          when: 'command reply indicates failure',
          reply,
          command,
        })
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
        args,
        bodyData,
      })

      return { headers, body: newBody }
    }
    return await this.enqueue(
      asyncLog(msg, this.ref(), sendHandler, this.logger)
    )
  }

  // Process data from the parser
  // ============================

  // Rewrite headers as needed to work around some weirdnesses in the protocol; and assign unified event IDs to the Event Socket's Content-Types.
  process(headers: Headers, body: Buffer): void {
    const contentType = headers.contentType
    if (contentType == null) {
      this.stats.missing_contentType++
      this.logger.error('FreeSwitchResponse::process: missing-content-type', {
        ref: this.__ref,
        headers,
        body,
      })
      this.emit(
        'error.missing-content-type',
        new FreeSwitchMissingContentTypeError(headers, body)
      )
      return
    }
    // Notice how all our (internal) event names are lower-cased; FreeSwitch always uses full-upper-case event names.
    switch (contentType) {
      // auth/request
      // ------------

      // FreeSwitch sends an authentication request when a client connect to the Event Socket.
      // Normally caught by the client code, there is no need for your code to monitor this event.
      case 'auth/request': {
        this.stats.auth_request++
        this.emit('freeswitch_auth_request', { headers, body })
        return
      }

      // command/reply
      // -------------

      // Commands trigger this type of event when they are submitted.
      // Normally caught by `send`, there is no need for your code to monitor this event.
      case 'command/reply': {
        this.stats.command_reply++
        this.emit('freeswitch_command_reply', { headers, body })
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
          this.logger.error('process: Invalid JSON', {
            ref: this.__ref,
            headers,
            body,
          })
          this.stats.json_parse_errors++
          if (exception instanceof Error) {
            this.emit('error.invalid-json', exception)
          } else {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            this.emit('error.invalid-json', new Error(`${exception}`))
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
          this.emit('error.invalid-json', new Error(body.toString()))
          return
        }

        // Otherwise trigger the proper event.
        const newBody = new Body(bodyValues)
        const newEvent = newBody.eventName
        if (typeof newEvent === 'string' && isEventName(newEvent)) {
          this.emit(newEvent, { headers, body: newBody })
        } else {
          this.logger.error(
            'FreeSwitchResponse: Missing or unknown event name',
            {
              ref: this.__ref,
              body,
            }
          )
          this.stats.missing_event_name++
          this.emit(
            'error.missing-event-name',
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
          this.logger.error(
            'FreeSwitchResponse: Missing or unknown event name',
            {
              ref: this.__ref,
              body,
            }
          )
          this.stats.missing_event_name++
          this.emit(
            'error.missing-event-name',
            new FreeSwitchMissingEventNameError(headers, body)
          )
        }
        return
      }

      // log/data
      // --------
      case 'log/data': {
        this.stats.log_data++
        this.emit('freeswitch_log_data', { headers, body })
        return
      }

      // text/disconnect-notice
      // ----------------------

      // FreeSwitch's indication that it is disconnecting the socket.
      case 'text/disconnect-notice': {
        this.stats.disconnect++
        this.emit('freeswitch_disconnect_notice', { headers, body })
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
        this.logger.error('FreeSwitchResponse: Unhandled Content-Type', {
          ref: this.__ref,
          contentType,
        })
        this.stats.unhandled++
        this.emit(
          'error.unhandled-content-type',
          new FreeSwitchUnhandledContentTypeError(contentType)
        )
      }
    }
  }

  // Channel-level commands
  // ======================

  // bgapi
  // -----

  /** Send an API command in the background. Wraps it inside a Promise.
   *  `bgapi` will throw if the job submission fails.
   *  However it will not throw if the background job failed. You can check the response
   *  from the background job in the `response` field of the return value.
   */
  async bgapi(command: string, timeout: number): SendResult {
    const jobUUID = ulid()
    const p = this.awaitBackgroundJob(jobUUID, timeout)
    const q = this.send(`bgapi ${command}`, { 'job-uuid': jobUUID }, timeout)
    const r = await Promise.all([p, q])
    return r[0]
  }

  // Event reception and filtering
  // =============================

  // event_json
  // ----------

  // Request that the server send us events in JSON format.
  // For example: `res.event_json 'HEARTBEAT'`
  async event_json(events: EventName[]): SendResult {
    return await this.send(
      `event json ${events.join(' ')}`,
      {},
      this.localTimeout
    )
  }

  // nixevents
  // ---------

  // Remove the given event types from the events ACL.
  async nixevent(events: EventName[]): SendResult {
    return await this.send(
      `nixevent ${events.join(' ')}`,
      {},
      this.localTimeout
    )
  }

  // noevents
  // --------

  // Remove all events types.
  async noevents(): SendResult {
    return await this.send('noevents', {}, this.localTimeout)
  }

  // filter
  // ------

  // Generic event filtering
  async filter(header: string, value: string): SendResult {
    return await this.send(`filter ${header} ${value}`, {}, this.localTimeout)
  }

  // filter_delete
  // -------------

  // Remove a filter.
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

  // sendevent
  // ---------

  // Send an event into the FreeSwitch event queue.
  async sendevent(eventName: EventName, args: ValueMap): SendResult {
    return await this.send(`sendevent ${eventName}`, args, this.localTimeout)
  }

  // Connection handling
  // ===================

  // auth
  // ----

  // Authenticate with FreeSwitch.

  // This normally not needed since in outbound (server) mode authentication is not required, and for inbound (client) mode the module authenticates automatically when requested.
  async auth(password: string): SendResult {
    return await this.send(`auth ${password}`, {}, this.localTimeout)
  }

  // Event logging
  // =============

  // log
  // ---

  // Enable logging on the socket, optionally setting the log level.
  async log(level: number): SendResult {
    if (level != null) {
      return await this.send(`log ${level}`, {}, this.localTimeout)
    } else {
      return await this.send('log', {}, this.localTimeout)
    }
  }

  // nolog
  // -----

  // Disable logging on the socket.
  async nolog(): SendResult {
    return await this.send('nolog', {}, this.localTimeout)
  }

  // Message sending
  // ===============

  // sendmsg_uuid
  // ------------

  // Send a command to a given UUID.
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

  /** Execute an application for the given UUID (in client mode). Does not await the result.
   * event-uuid and event-uuid-name are set as `app_uuid` and `app_uuid_name` in the channel, respectively.
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

  /** Execute an application synchronously. Return a Promise.
   */
  async command_uuid(
    uuid: string,
    appName: string,
    appArg: string = '',
    timeout: number
  ): SendResult {
    const eventUUID: string = ulid()
    const p = this.awaitExecuteComplete(eventUUID, timeout)
    const q = this.execute_uuid(uuid, appName, appArg, {
      'event-uuid': eventUUID,
    })
    const r = await Promise.all([p, q])
    return r[0]
  }

  // hangup_uuid
  // -----------

  /** Hangup the call referenced by the given UUID with an optional (FreeSwitch) cause code.
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

  // Forwards the media to and from a given socket.

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

  localTimeout = 1_000
}
