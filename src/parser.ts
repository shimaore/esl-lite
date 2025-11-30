// Event Socket stream parser
// ==========================
import { Logger } from 'pino'
import { Headers } from './headers.js'

/**
 * Error indicates that the buffer was not empty when the connection was closed.
 *
 * This is harmless.
 */
export class FreeSwitchParserNonEmptyBufferAtEndError extends Error {
  override name = 'FreeSwitchParserNonEmptyBufferAtEndError' as const
  constructor(public readonly buffer: Buffer) {
    super(JSON.stringify({ buffer }))
  }
}

/**
 * Type for a parser callback
 */
export type ProcessorInput = {
  headers: Headers
  body: Buffer
}

/**
 * Low-level event socket parser
 *
 * Parses headers and collects (but does not parse) an event's body.
 */
export const FreeSwitchParser = async function* (
  socket: AsyncIterable<Buffer>,
  logger: Logger
): AsyncGenerator<ProcessorInput | FreeSwitchParserNonEmptyBufferAtEndError> {
  /** Current set of buffers to be processed (either headers or body). */
  const buffers: Buffer[] = []
  /** Total number of bytes stored in `buffers`. */
  let buffersLength = 0

  let headers: Headers = new Headers()
  /* Expected body-length */
  let bodyLength = 0
  const theEmptyBuffer = Buffer.alloc(0)

  /* Read the socket using an async iterator */
  for await (const chunk of socket) {
    try {
      let data = chunk

      while (data.length > 0) {
        /* Capture body */
        while (bodyLength > 0 && data.length > 0) {
          /* When capturing the body, `buffers` contains the current data (text), `bodyLength` contains how many bytes are expected to be read in the body,
           * and `buffersLength` contains how many bytes have been receiveds so far.
           */
          buffers.push(data)
          /* As long as the whole body hasn't been received, keep adding the new data into the buffer. */
          if (buffersLength + data.length < bodyLength) {
            buffersLength += data.length
            data = theEmptyBuffer
            continue
          }

          /* Consume the body once it has been fully received, up to bodyLength. */
          const body = Buffer.concat(buffers, bodyLength)

          /* Process the content at each step. */
          const content = { headers, body }

          /* Push back the remaining of the received data for processing (as headers) */
          data = data.subarray(bodyLength - buffersLength)

          /* Reset */
          bodyLength = 0
          headers = new Headers()

          /* Re-parse whatever data was left after the body was fully consumed. */
          buffersLength = 0
          buffers.length = 0

          yield content
        }

        /* Capture headers */
        while (bodyLength === 0 && data.length > 0) {
          /* Capture headers, meaning up to the first blank line. */
          buffers.push(data)
          /* Wait until we reach the end of the header. */
          const headerEnd = data.indexOf('\n\n')
          if (headerEnd < 0) {
            buffersLength += data.length
            data = theEmptyBuffer
            continue
          }

          /* Consume the headers once they have been fully received. */
          const headerBuffer = Buffer.concat(buffers, buffersLength + headerEnd)
          /* Push back the remaining of the received data for processing (as headers) */
          data = data.subarray(headerEnd + 2)

          /* Parse the header lines */
          headers = parseHeaders(headerBuffer)
          /* Figure out whether a body is expected */
          buffersLength = 0
          buffers.length = 0

          const contentLength = headers.contentLength
          if (contentLength != null) {
            /* Save the Content-Length as expected body length */
            bodyLength = contentLength
            /* Parse the body (and eventually process) */
            continue
          }

          /* Process the (header-only) content */
          const content = { headers, body: Buffer.alloc(0) }
          headers = new Headers()
          yield content
          /* Re-parse whatever data was left after these headers were fully consumed. */
        }
      }
    } catch (err: unknown) {
      logger.error({ err }, 'chunk processing failed')
    }
  }

  if (buffersLength > 0) {
    yield new FreeSwitchParserNonEmptyBufferAtEndError(Buffer.concat(buffers))
  }
}

// Headers parser
// ==============

/**
 * Parses headers
 *
 * Event Socket framing contains headers and a body.
 *
 * The header must be decoded first to learn the presence and length of the body.
 */
export const parseHeaders = function (headerBuffer: Buffer): Headers {
  const headerLine = headerBuffer.toString('utf8').split('\n')
  const headers = new Headers()
  for (const line of headerLine) {
    const [name, value] = line.split(/: /, 2)
    if (name != null && value != null) {
      headers.set(name, value)
    }
  }
  return headers
}
