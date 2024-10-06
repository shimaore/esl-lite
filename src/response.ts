// Response and associated API
// ===========================
import {
  AbortSignalEventEmitter,
  FreeSwitchEventEmitter,
} from './event-emitter.js'

import { ulid } from 'ulidx'

import { type Headers } from './headers.js'

import { type EventName } from './event-names.js'
import { jsonParseBuffer, type JSONValue } from './json-value.js'
import { Body } from './body.js'
import { EslLite, FreeSwitchWriteError } from './lite.js'
import { FreeSwitchParserNonEmptyBufferAtEndError } from './parser.js'
import {
  FreeSwitchDisconnectNotice,
  FreeSwitchInvalidBodyError,
  FreeSwitchMissingContentTypeError,
  FreeSwitchMissingEventNameError,
  FreeSwitchUnexpectedApiResponse,
  FreeSwitchUnexpectedRudeRejection,
  FreeSwitchUnhandledContentTypeError,
} from './raw-event.js'
import { type Logger } from 'pino'
import Queue from 'yocto-queue'

/**
 * This is a base class for the FreeSwitchClient.
 *
 * ```ts
 * const client = new FreeSwitchClient({ logger: pino.default() })
 * await client.bgapi('reloadxml', 1_000)
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
  /** Send an API command in the background. Await the command's result.
   *
   * `bgapi` will return an error if the job submission fails.
   *
   * It will not return an error if the bakcground job itself failed.
   * The response from the background job will be stored in the `.body.response` field of the return value.
   *
   * The `timeout` parameter should encompass job submission and the command completion.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async bgapi(
    command: string,
    timeout: number
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchAbortError
    | FreeSwitchApplicationEndedError
    | FreeSwitchFailedCommandError
    | FreeSwitchNoReplyError
    | FreeSwitchTimeoutError
  > {
    const jobUUID = ulid()
    const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
    const p = this.awaitBackgroundJob(jobUUID, timeout, signal)
    this.logger.trace({ command }, 'bgapi: sending')
    const q = await this.send(
      `bgapi ${command}`,
      { 'job-uuid': jobUUID },
      timeout
    )
    this.logger.trace({ q }, 'bgapi: sent')
    if (q instanceof Error) {
      signal.emit('abort', undefined)
      return q
    }
    const outcome = await p
    this.logger.trace({ outcome }, 'bgapi: outcome')
    return outcome
  }

  /**
   * End this instance.
   */
  end(): void {
    this.lite.end()
    this.cleanup()
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

  /** EventEmitter for log events
   * You must use `client.log()` beforehand to specify the log level.
   */
  public readonly logs = new FreeSwitchEventEmitter<
    'log',
    { log: (data: FreeSwitchParserData) => void }
  >()

  /**
   * Enable logging on the socket, setting the log level.
   *
   * ```
   * client.log(7)
   * client.logs.on('log', (data) => { … })
   * ```
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async log(level: number, timeout: number): SendResult {
    if (level != null) {
      return await this.send(`log ${level}`, {}, timeout)
    } else {
      return await this.send('log', {}, timeout)
    }
  }

  /**
   * Disable logging on the socket.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async nolog(timeout: number): SendResult {
    return await this.send('nolog', {}, timeout)
  }

  /**
   * Send an event into the FreeSwitch event queue.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async sendevent(
    eventName: EventName,
    args: ValueMap,
    timeout: number
  ): SendResult {
    return await this.send(
      `sendevent ${eventName}`,
      { 'Event-Name': eventName, ...args },
      timeout
    )
  }

  /**
   * Execute an application for the given UUID (channel). Does not await the result.
   * `event-uuid` and `event-uuid-name` are set as `app_uuid` and `app_uuid_name` in the channel, respectively.
   *
   * If you would like to await the result, use `command_uuid`.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async execute_uuid(
    uuid: string,
    appName: string,
    appArg: string,
    headers: {
      'event-uuid'?: string
      'event-uuid-name'?: string
      'content-type'?: string
      loops?: number
      'hold-bleg'?: boolean
    },
    timeout: number
  ): SendResult {
    const options = {
      ...headers,
      'execute-app-name': appName,
      'execute-app-arg': appArg,
    }
    return await this.sendmsg_uuid(uuid, 'execute', options, timeout)
    // TODO: Support the alternate format (with no `execute-app-arg` header but instead a `text/plain` body containing the argument).
  }

  /**
   * Execute an application synchronously on a channel. Await the result.
   *
   * Check the result's `response` field to know the outcome of a command.
   * The first character indicates success (`+`) or failure (`-`).
   *
   * If you would like an async version, use `execute_uuid`.
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
    | FreeSwitchNoReplyError
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
    | FreeSwitchApplicationEndedError
    | FreeSwitchFailedCommandError
  > {
    const signal: AbortSignalEventEmitter = new FreeSwitchEventEmitter()
    const eventUUID: string = ulid()
    const p = this.awaitExecuteComplete(eventUUID, timeout, signal)
    const q = await this.execute_uuid(
      uuid,
      appName,
      appArg,
      {
        'event-uuid': eventUUID,
      },
      timeout
    )
    if (q instanceof Error) {
      signal.emit('abort', undefined)
      return q
    }
    return await p
  }

  /**
   * Hangup the call referenced by the given UUID with an optional (FreeSwitch) cause code.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  async hangup_uuid(
    uuid: string,
    hangupCause = 'NORMAL_UNSPECIFIED',
    timeout: number
  ): SendResult {
    const options = {
      'hangup-cause': hangupCause,
    }
    return await this.sendmsg_uuid(uuid, 'hangup', options, timeout)
  }

  /**
   * Forwards the media to and from a given socket.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
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
    },
    timeout: number
  ): SendResult {
    const options = {
      ...args,
      'local-port': args['local-port'].toString(10),
      'remote-port': args['remote-port'].toString(10),
    } as const
    return await this.sendmsg_uuid(uuid, 'unicast', options, timeout)
  }

  // nomedia_uuid
  // ------------
  // Not implemented yet (TODO).

  // switch_ivr.c also lists `xferext` in `switch_ivr_parse_event`.

  /** Statistics about this connection */
  public stats: {
    /**
     * Number of missing Content-Type headers
     */
    missingContentType: bigint
    /**
     * Number of missing Event-Name headers
     */
    missingEventName: bigint
    /**
     * Number of authentication requests
     */
    authRequest: bigint
    /**
     * Number of command replies
     */
    commandReply: bigint
    /**
     * Number of FreeSwitch events received
     */
    events: bigint
    /**
     * Number of body parse errors
     */
    bodyParseErrors: bigint
    /**
     * Number of log data events received
     */
    logData: bigint
    /**
     * Number of disconnect event received
     */
    disconnect: bigint
    /**
     * Number of api responses
     */
    apiResponses: bigint
    /**
     * Number of rude rejections (generally due to ACL access to the Event Socket)
     */
    rudeRejections: bigint
    /**
     * Number of unhandled events
     */
    unhandled: bigint
    /**
     * Number of unflushed writes, indicating the network or FreeSwitch are not keeping up with our traffic
     */
    unflushedWrites: bigint
    /**
     * Number of unexpected non-empty buffer at end of processing.
     */
    nonEmptyBufferAtEnd: bigint
  } = {
    missingContentType: 0n,
    missingEventName: 0n,
    authRequest: 0n,
    commandReply: 0n,
    events: 0n,
    bodyParseErrors: 0n,
    logData: 0n,
    disconnect: 0n,
    apiResponses: 0n,
    rudeRejections: 0n,
    unhandled: 0n,
    unflushedWrites: 0n,
    nonEmptyBufferAtEnd: 0n,
  }

  /** Uniquely identify each instance, for tracing purposes. */
  public readonly ref: string = ulid()

  /* ----------- End of public methods and data ------------ */

  /**
   * Constructor is not meant to be used publicly.
   */
  protected constructor(
    private readonly lite: EslLite,
    private readonly password: string,
    logger: Logger
  ) {
    super(
      (event: EventName) => {
        this.registeredEventNames.add(event)
        this.event_json(event)
      }
      // (event:EventName) => { this.nixevent(event) },
    )
    this.logger = logger.child({
      module: 'FreeSwitchResponse',
      ref: this.ref,
    })
    this.custom = new FreeSwitchEventEmitter((subclass: string) => {
      this.registeredCustomSubsclasses.add(subclass)
      this.event_json_custom(subclass)
    })

    /* Register our internal event names */
    this.registeredEventNames.add('CUSTOM')
    this.registeredEventNames.add('CHANNEL_EXECUTE_COMPLETE')
    this.registeredEventNames.add('BACKGROUND_JOB')
  }

  private readonly logger: Logger

  /**
   * Set of registered event names.
   * This is used to re-send `event_json` when reconnecting.
   */
  private readonly registeredEventNames = new Set<EventName>()
  /**
   * Set or registered subclasses for CUSTOM events.
   * This is used to re-send `event_json_custom` when reconnecting.
   */
  private readonly registeredCustomSubsclasses = new Set<string>()

  private sendNextCommand: () => void = () => {
    this.logger.info({}, 'this.sendNextCommand called before connect()')
  }

  protected async connect() {
    this.logger.info({}, 'connect')

    let currentCommand: CommandRequest | undefined

    const sendNextCommand = (): void => {
      /* A command is already pending; the next one will be sent when we receive its reply */
      if (currentCommand != null) {
        this.logger.trace(
          { size: this.queue.size },
          'sendNextCommand: current command pending'
        )
        return
      }

      /* assert.strictEqual(currentCommand, undefined) */
      this.logger.trace({ size: this.queue.size }, 'sendNextCommand')

      const request = this.queue.peek()

      /* No pending request */
      if (request == null) {
        return
      }

      /* Send command out async */
      const resolve = (outcome: undefined | FreeSwitchWriteError): void => {
        if (outcome instanceof Error) {
          /* Will re-send */
          this.logger.warn({ err: outcome, request }, 'lite.write failed')
          return
        }
        /* The command will be resolved once `freeswitch_command_reply` is received. */
        this.logger.debug({ outcome, request }, 'lite.write completed')
        return
      }
      this.queue.dequeue()
      currentCommand = request
      this.lite.write({ buf: request.buf, resolve })
    }

    this.sendNextCommand = sendNextCommand

    for await (const ev of this.lite.connect()) {
      this.logger.trace({ ev }, 'event')

      if (ev instanceof Error) {
        if (ev instanceof FreeSwitchParserNonEmptyBufferAtEndError) {
          this.logger.info(
            { buf: ev.buffer.toString() },
            'Buffer non-empty at end of stream'
          )
          this.stats.nonEmptyBufferAtEnd++
          continue
        }
        if (ev instanceof FreeSwitchMissingContentTypeError) {
          this.stats.missingContentType++
          continue
        }
        if (ev instanceof FreeSwitchMissingEventNameError) {
          this.stats.missingEventName++
          continue
        }
        if (ev instanceof FreeSwitchInvalidBodyError) {
          this.stats.bodyParseErrors++
          continue
        }
        if (ev instanceof FreeSwitchUnexpectedRudeRejection) {
          this.stats.rudeRejections++
          continue
        }
        if (ev instanceof FreeSwitchUnhandledContentTypeError) {
          this.stats.unhandled++
          continue
        }
        if (ev instanceof FreeSwitchDisconnectNotice) {
          this.stats.disconnect++
          continue
        }
        if (ev instanceof FreeSwitchUnexpectedApiResponse) {
          this.stats.apiResponses++
          continue
        }
        continue
      }

      switch (ev.event) {
        /** FreeSwitch sends an authentication request when a client connect to the Event Socket.
         * Caught by the client code, there is no need for application code to monitor this event.
         * We use it to trigger the remainder of the stack.
         */
        case 'freeswitch_auth_request': {
          this.stats.authRequest++

          const requeue: CommandRequest[] = []
          if (currentCommand != null) {
            requeue.push(currentCommand)
          }
          if (this.queue.size > 0) {
            for (const item of this.queue) {
              requeue.push(item)
            }
          }

          /* Rebuild the queue from scratch */
          this.queue.clear()
          currentCommand = undefined

          /* Authenticate */
          this.queue.enqueue({
            queued: performance.now(),
            buf: Buffer.from(`auth ${this.password}\n\n`),
            resolve: (res) => {
              this.logger.debug({ res }, 'Authenticated')
            },
          })
          this.logger.debug({}, 'Authenticating')
          /* We call `sendNextCommand()` now because `event_json` etc will call it again. */
          sendNextCommand()

          /* Registers all know events */
          this.registeredEventNames.forEach((eventName) => {
            this.event_json(eventName)
          })
          this.registeredCustomSubsclasses.forEach((subclass) => {
            this.event_json_custom(subclass)
          })

          /* Finally, re-queue any pending commands */
          requeue.forEach((item) => this.queue.enqueue(item))

          break
        }

        case 'freeswitch_command_reply': {
          this.stats.commandReply++
          if (currentCommand != null) {
            const delay = performance.now() - currentCommand.queued
            this.logger.debug({ delay }, 'Command round-trip time')
            currentCommand.resolve({ headers: ev.headers, body: ev.body })
            currentCommand = undefined
          } else {
            this.logger.warn(
              { ev },
              'Received command-reply while no command was pending'
            )
          }
          sendNextCommand()
          break
        }

        case 'freeswitch_log_data': {
          this.logs.emit('log', ev)
          break
        }

        case 'CHANNEL_EXECUTE_COMPLETE': {
          const eventUUID = ev.body.applicationUUID
          if (eventUUID != null) {
            const resolver = this.executeCompleteMap.get(eventUUID)
            if (resolver != null) {
              this.executeCompleteMap.delete(eventUUID)
              resolver(ev)
            }
          }
          this.emit(ev.event, ev)
          this.emit('ALL', ev)
          break
        }

        case 'BACKGROUND_JOB': {
          const jobUUID = ev.body.jobUUID
          if (jobUUID != null) {
            const resolver = this.backgroundJobMap.get(jobUUID)
            if (resolver != null) {
              this.backgroundJobMap.delete(jobUUID)
              resolver(ev)
            }
          }
          this.emit(ev.event, ev)
          this.emit('ALL', ev)
          break
        }

        case 'CUSTOM': {
          const subclass = ev.body.data['Event-Subclass']
          if (typeof subclass === 'string') {
            this.custom.emit(subclass, ev)
          }
          this.emit(ev.event, ev)
          this.emit('ALL', ev)
          break
        }

        default: {
          this.emit(ev.event, ev)
          this.emit('ALL', ev)
          break
        }
      }

      this.logger.trace({}, 'awaiting next event')
    }

    currentCommand?.resolve(new FreeSwitchApplicationEndedError())
    this.cleanup()
    this.logger.info({}, 'Terminated')
  }

  private cleanup() {
    this.logger.debug(
      {
        size:
          this.backgroundJobMap.size +
          this.executeCompleteMap.size +
          this.queue.size,
      },
      'Cleaning up'
    )

    /* Cleanup */
    this.custom.removeAllListeners()
    this.logs.removeAllListeners()

    this.backgroundJobMap.forEach((resolve) =>
      resolve(new FreeSwitchApplicationEndedError())
    )
    this.backgroundJobMap.clear()
    this.executeCompleteMap.forEach((resolve) =>
      resolve(new FreeSwitchApplicationEndedError())
    )
    this.executeCompleteMap.clear()

    /* Clear queue */
    this.logger.debug({ size: this.queue.size }, 'Clearing queued queries')
    for (const request of this.queue) {
      try {
        request.resolve(new FreeSwitchApplicationEndedError())
      } catch (err) {
        this.logger.error({ err }, 'Finalizing')
      }
    }
    this.queue.clear()
  }

  /** Queued commands waiting to be sent to FreeSwitch */
  private readonly queue = new Queue<CommandRequest>()

  /** Resolvers waiting for their matching CHANNEL_EXECUTE_COMPLETE */
  private readonly executeCompleteMap = new Map<
    string,
    (res: FreeSwitchEventData | FreeSwitchApplicationEndedError) => void
  >()

  private async awaitExecuteComplete(
    eventUUID: string,
    timeout: number,
    signal: AbortSignalEventEmitter
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
    | FreeSwitchApplicationEndedError
  > {
    const p = this.awaitSignal<
      FreeSwitchEventData | FreeSwitchApplicationEndedError
    >(timeout, signal, (resolve) => {
      this.executeCompleteMap.set(eventUUID, resolve)
      return () => {
        this.executeCompleteMap.delete(eventUUID)
      }
    })
    return await p
  }

  /** Resolvers waiting for their matching BACKGROUND_JOB */
  private readonly backgroundJobMap = new Map<
    string,
    (res: FreeSwitchEventData | FreeSwitchApplicationEndedError) => void
  >()

  private async awaitBackgroundJob(
    jobUUID: string,
    timeout: number,
    signal: AbortSignalEventEmitter
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchTimeoutError
    | FreeSwitchAbortError
    | FreeSwitchApplicationEndedError
  > {
    const p = this.awaitSignal<
      FreeSwitchEventData | FreeSwitchApplicationEndedError
    >(timeout, signal, (resolve) => {
      this.backgroundJobMap.set(jobUUID, resolve)
      return () => {
        this.backgroundJobMap.delete(jobUUID)
      }
    })
    return await p
  }

  /**
   * A generic way of sending commands to FreeSwitch; waits for FreeSwitch's notification that the command completed.
   *
   * This is a low-level method; in most cases one should use `bgapi`, `command_uuid`, etc
   * which provide higher-level APIs.
   *
   * This method is not exposed by default; create a subclass of FreeSwitchClient in order to access it.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  protected async send(
    command: string,
    commandHeaders: ValueMap,
    timeout: number
  ): Promise<
    | FreeSwitchEventData
    | FreeSwitchAbortError
    | FreeSwitchApplicationEndedError
    | FreeSwitchFailedCommandError
    | FreeSwitchNoReplyError
    | FreeSwitchTimeoutError
  > {
    this.logger.trace(
      { command, commandHeaders, timeout },
      'send: await enqueue'
    )
    const value = await new Promise<
      | FreeSwitchParserData
      | FreeSwitchApplicationEndedError
      | FreeSwitchTimeoutError
    >((resolve) => {
      this.queue.enqueue({
        buf: buildCommand(command, commandHeaders),
        resolve,
        queued: performance.now(),
      })
      this.sendNextCommand()
    })
    this.logger.trace({ value }, 'send: enqueue done')

    if (value instanceof Error) {
      return value
    }

    const { headers, body } = value
    this.logger.trace(
      {
        command,
        commandHeaders,
        headers,
        body,
      },
      'FreeSwitchResponse: send: received reply'
    )
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
    } catch {
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

    this.logger.trace(
      {
        command,
        commandHeaders,
        headers,
        bodyData,
      },
      'FreeSwitchResponse: send: success'
    )

    return { headers, body: newBody }
  }

  /**
   * Send a message to a given UUID (channel).
   *
   * This is a low-level operation; in most cases `execute_uuid`, `command_uuid` etc
   * will provide a better API.
   *
   * This method is not exposed by default; create a subclass of FreeSwitchClient in order to access it.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  protected async sendmsg_uuid(
    uuid: string,
    command: string,
    args: ValueMap,
    timeout: number
  ): SendResult {
    const headers = { ...args, 'call-command': command }
    // alternatively, `uuid` might be specified as header `session-id`
    const executeText = `sendmsg ${uuid}`
    return await this.send(executeText, headers, timeout)
  }

  /**
   * Request that the server adds the events to its filter, and provide them in JSON format.
   */
  private event_json(event: EventName): void {
    this.queue.enqueue({
      queued: performance.now(),
      buf: Buffer.from(`event json ${event}\n\n`),
      resolve: () => true,
    })
    this.sendNextCommand()
  }

  /**
   * Request that the server adds the CUSTOM event to its filter, and provide them in JSON format.
   */
  private event_json_custom(subclass: string): void {
    /* Notice the extra space at the end, required due to a bug in mod_esl */
    this.queue.enqueue({
      queued: performance.now(),
      buf: Buffer.from(`event json CUSTOM ${subclass} \n\n`),
      resolve: () => true,
    })
    this.sendNextCommand()
  }

  /**
   * Remove the given event types from the events ACL.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  /*
  private async nixevent(event: EventName): SendResult {
    return await this.send(`nixevent ${event}`, {}, this.localTimeout)
  }
  */

  /**
   * Remove all events types from the filters.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  /*
  private async noevents(): SendResult {
    return await this.send('noevents', {}, this.localTimeout)
  }
  */

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
  /*
  private async filter(header: string, value: string): SendResult {
    return await this.send(`filter ${header} ${value}`, {}, this.localTimeout)
  }
  */

  /**
   * Remove a generic header-and-value filter.
   *
   * This method is not expected to throw / return a rejected Promise.
   */
  /*
  private async filter_delete(header: string, value: string): SendResult {
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
  */

  private async awaitSignal<T>(
    timeout: number,
    signal: AbortSignalEventEmitter,
    handler: (resolve: (v: T) => void) => () => void
  ): Promise<T | FreeSwitchTimeoutError | FreeSwitchAbortError> {
    return await new Promise((resolve) => {
      const timeoutHandler = (): void => {
        // clearTimeout(timer)
        signal.removeListener('abort', signalAbortHandler)
        canceler()
        resolve(new FreeSwitchTimeoutError(timeout, 'awaitSignal'))
      }

      const signalAbortHandler = (): void => {
        clearTimeout(timer)
        // signal.removeListener('abort', signalAbortHandler)
        canceler()
        resolve(new FreeSwitchAbortError())
      }

      const successHandler = (v: T): void => {
        clearTimeout(timer)
        signal.removeListener('abort', signalAbortHandler)
        // canceler()
        resolve(v)
      }

      const timer = setTimeout(timeoutHandler, timeout)
      signal.once('abort', signalAbortHandler)
      const canceler = handler(successHandler)
    })
  }
}

/**
 * Build a single command for FreeSwitch; `args` is a hash of headers sent with the command.
 */
const buildCommand = (command: string, headers: ValueMap): Buffer => {
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
  return Buffer.from(text)
}

/**
 * An object containing simple JSON values
 */
export type ValueMap = Record<string, string | number | boolean | undefined>

/**
 * Error: timeout occurred
 */
export class FreeSwitchTimeoutError extends Error {
  override name = 'FreeSwitchTimeoutError' as const
  constructor(
    public readonly timeout: number,
    public readonly text: string
  ) {
    super(`Timeout after ${timeout}ms waiting for ${text}`)
  }
}

/**
 * Error: response from FreeSwitch does not contain a proper reply
 */
export class FreeSwitchNoReplyError extends Error {
  override name = 'FreeSwitchNoReplyError' as const
  constructor(public readonly command: string) {
    super('No reply')
  }
}

/**
 * Error: command failed
 */
export class FreeSwitchFailedCommandError extends Error {
  override name = 'FreeSwitchFailedCommandError' as const
  constructor(
    public readonly command: string,
    public readonly response: string
  ) {
    super('Command failed')
  }
}

/**
 * Error: operation was canceled
 */
export class FreeSwitchAbortError extends Error {
  override name = 'FreeSwitchAbortError' as const
  constructor() {
    super('Operation was canceled')
  }
}

/**
 * Response received from FreeSwitch, including headers and body
 */
export type FreeSwitchEventData = {
  /** Headers */
  headers: Headers
  /** Body */
  body: Body
}

/**
 * Response received from FreeSwitch, with only the headers parsed
 */
export type FreeSwitchParserData = {
  headers: Headers
  body: Buffer
}

/**
 * Type returned by most APIs in FreeSwitchResponse
 */
export type SendResult = Promise<
  | FreeSwitchEventData
  | FreeSwitchAbortError
  | FreeSwitchApplicationEndedError
  | FreeSwitchFailedCommandError
  | FreeSwitchNoReplyError
  | FreeSwitchTimeoutError
>

/**
 * Type definitions for all FreeSwitch events.
 */
export type FreeSwitchPublicResponseEvents = {
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

type CommandRequest = {
  buf: Buffer
  /** performance.now() time of enqueuing */
  queued: number
  resolve: (
    result:
      | FreeSwitchParserData
      | FreeSwitchTimeoutError
      | FreeSwitchApplicationEndedError
  ) => void
}

export class FreeSwitchApplicationEndedError extends Error {
  override name = 'FreeSwitchParserNonEmptyBufferAtEndError' as const
  constructor() {
    super('Application closing')
  }
}
