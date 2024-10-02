import { Body } from './body.js'
import { Headers } from './headers.js'
import { EventName, isEventName } from './event-names.js'
import { jsonParseBuffer, JSONValue } from './json-value.js'
import { ProcessorInput } from './parser.js'

export type ProcessedEvents =
  /* Low-level responses */
  | {
      event:
        | 'freeswitch_auth_request'
        | 'freeswitch_command_reply'
        | 'freeswitch_log_data'
      headers: Headers
      body: Buffer
    }
  /* Events */
  | { event: EventName; headers: Headers; body: Body }
  /* Errors */
  | FreeSwitchMissingContentTypeError
  | FreeSwitchInvalidBodyError
  | FreeSwitchMissingEventNameError
  | FreeSwitchUnhandledContentTypeError
  | FreeSwitchDisconnectNotice
  | FreeSwitchUnexpectedApiResponse
  | FreeSwitchUnexpectedRudeRejection

/** (internal) Process data from the parser.
 *
 * This private method rewrites headers as needed to work around some weirdnesses in the protocol;
 * and assign unified event IDs to the Event Socket's Content-Types.
 */
export const processRawEvent = ({
  headers,
  body,
}: ProcessorInput): ProcessedEvents => {
  const contentType = headers.contentType
  if (contentType == null) {
    return new FreeSwitchMissingContentTypeError(headers, body)
  }
  // Notice how all our (internal) event names are lower-cased; FreeSwitch always uses full-upper-case event names.
  switch (contentType) {
    // auth/request
    // ------------

    // FreeSwitch sends an authentication request when a client connect to the Event Socket.
    // Normally caught by the client code, there is no need for application code to monitor this event.
    case 'auth/request':
      return { event: 'freeswitch_auth_request', headers, body }

    // command/reply
    // -------------

    // Commands trigger this type of event when they are submitted.
    // Normally caught by `send`, there is no need for application code to monitor this event.
    case 'command/reply': {
      return { event: 'freeswitch_command_reply', headers, body }
    }

    // text/event-json
    // ---------------

    // A generic event with a JSON body. We map it to its own Event-Name.
    case 'text/event-json': {
      let bodyValues: JSONValue = null
      // Strip control characters that might be emitted by FreeSwitch.
      // body = body.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      try {
        // Parse the JSON body.
        bodyValues = jsonParseBuffer(body)
      } catch (exception) {
        // In case of error report it as an error.
        if (exception instanceof SyntaxError) {
          return new FreeSwitchInvalidBodyError(
            `JSON parsing error`,
            exception,
            body.toString()
          )
        } else {
          return new FreeSwitchInvalidBodyError(
            `Unknown JSON parsing error`,
            exception,
            body.toString()
          )
        }
      }

      if (
        bodyValues == null ||
        typeof bodyValues === 'string' ||
        typeof bodyValues === 'number' ||
        typeof bodyValues === 'boolean' ||
        Array.isArray(bodyValues)
      ) {
        return new FreeSwitchInvalidBodyError(
          'Invalid content',
          null,
          body.toString()
        )
      }

      // Otherwise trigger the proper event.
      const newBody = new Body(bodyValues)
      const newEvent = newBody.eventName
      if (typeof newEvent === 'string' && isEventName(newEvent)) {
        return { event: newEvent, headers, body: newBody }
      } else {
        return new FreeSwitchMissingEventNameError(headers, body)
      }
    }

    // text/event-plain
    // ----------------

    // Same as `text/event-json` except the body is encoded using plain text. Either way the module provides you with a parsed body (a hash/Object).
    case 'text/event-plain': {
      const newBody = parseBody(body)
      const newEvent = newBody.eventName
      if (newEvent != null && isEventName(newEvent)) {
        return { event: newEvent, headers, body: newBody }
      } else {
        return new FreeSwitchMissingEventNameError(headers, body)
      }
    }

    // log/data
    // --------
    case 'log/data': {
      return { event: 'freeswitch_log_data', headers, body }
    }

    // text/disconnect-notice
    // ----------------------

    // FreeSwitch's indication that it is disconnecting the socket.
    case 'text/disconnect-notice': {
      return new FreeSwitchDisconnectNotice()
    }

    // api/response
    // ------------

    // Triggered when an `api` message returns.
    // We never send `api` messages, therefor we do not expect those to come back.
    case 'api/response': {
      /* We never send those */
      return new FreeSwitchUnexpectedApiResponse()
    }

    // Received rude rejection, most probably due to ACL
    case 'text/rude-rejection': {
      return new FreeSwitchUnexpectedRudeRejection()
    }

    default: {
      // Ideally other content-types should be individually specified. In any case we provide a fallback mechanism.
      // Others?
      // -------
      return new FreeSwitchUnhandledContentTypeError(contentType)
    }
  }
}

/**
 * Parse a non-JSON event body received from FreeSwitch
 */
const parseBody = function (bodyBuffer: Buffer): Body {
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
 * Error: missing Content-Type header in event
 */
export class FreeSwitchMissingContentTypeError extends Error {
  override name = 'FreeSwitchMissingContentTypeError' as const
  constructor(
    public readonly headers: Headers,
    public readonly body: Buffer
  ) {
    super('Missing Content-Type')
  }
}

/**
 * Error: event body is invalid
 */
export class FreeSwitchInvalidBodyError extends Error {
  override name = 'FreeSwitchInvalidBodyError' as const
  constructor(
    public readonly description: string,
    public readonly exception: unknown,
    public readonly body: string
  ) {
    super('Invalid event body')
  }
}

/**
 * Error: event name is missing in event headers
 */
export class FreeSwitchMissingEventNameError extends Error {
  override name = 'FreeSwitchMissingEventNameError' as const
  constructor(
    public readonly headers: Headers,
    public readonly body: Buffer
  ) {
    super('Missing Event-Name')
  }
}

/**
 * Error: un-supported Content-Type in event
 */
export class FreeSwitchUnhandledContentTypeError extends Error {
  override name = 'FreeSwitchUnhandledContentTypeError' as const
  constructor(public readonly contentType: string) {
    super(`Unhandled Content-Type ${contentType}`)
  }
}

/**
 * Error: FreeSwitch sent a disconnect notice
 */
export class FreeSwitchDisconnectNotice extends Error {
  override name = 'FreeSwitchDisconnectNotice' as const
}

/**
 * Error: FreeSwitch sent an API response (we never send API requests)
 */
export class FreeSwitchUnexpectedApiResponse extends Error {
  override name = 'FreeSwitchUnexpectedApiResponse' as const
}

/**
 * Error: FreeSwitch send a rude rejection (most probably the client
 * is not authorized in the FreeSwitch ACL for the event socket)
 */
export class FreeSwitchUnexpectedRudeRejection extends Error {
  override name = 'FreeSwitchUnexpectedRudeRejection' as const
}
