// Event Socket stream parser
// ==========================
import { type Socket } from 'node:net'
import { Headers } from './headers.js'

export class FreeSwitchParserError extends Error {
  public readonly error: string
  public readonly buffer: Buffer
  constructor(error: string, buffer: Buffer) {
    super(JSON.stringify({ error, buffer }))
    this.error = error
    this.buffer = buffer
  }
}

type Processor = (headers: Headers, body: Buffer) => void

export const FreeSwitchParser = async (
  socket: Socket,
  processMessage: Processor
): Promise<void> => {
  let bodyLength: number = 0
  let buffers: Buffer[] = []
  let buffersLength: number = 0
  let headers: Headers = new Headers()

  // ### Capture body
  const captureBody = (data: Buffer): void => {
    /* When capturing the body, `buffers` contains the current data (text), `bodyLength` contains how many bytes are expected to be read in the body,
     * and `buffersLength` contains how many bytes have been receiveds so far.
     */
    buffers.push(data)
    // As long as the whole body hasn't been received, keep adding the new data into the buffer.
    if (buffersLength + data.length < bodyLength) {
      buffersLength += data.length
      return
    }
    // Consume the body once it has been fully received.
    const bodyBuffer = Buffer.concat(buffers, bodyLength)
    const nextBuffer = data.subarray(bodyLength - buffersLength)

    // Process the content at each step.
    processMessage(headers, bodyBuffer)

    bodyLength = 0
    headers = new Headers()

    // Re-parse whatever data was left after the body was fully consumed.
    buffersLength = 0
    buffers = []
    captureHeaders(nextBuffer)
  }

  // ### Capture headers
  const captureHeaders = (data: Buffer): void => {
    // Capture headers, meaning up to the first blank line.
    buffers.push(data)
    // Wait until we reach the end of the header.
    const headerEnd = data.indexOf('\n\n')
    if (headerEnd < 0) {
      buffersLength += data.length
      return
    }
    // Consume the headers
    const headerBuffer = Buffer.concat(buffers, buffersLength + headerEnd)
    const nextBuffer = data.subarray(headerEnd + 2)

    // Parse the header lines
    headers = parseHeaders(headerBuffer)
    // Figure out whether a body is expected
    buffersLength = 0
    buffers = []

    const contentLength = headers.contentLength
    if (contentLength != null) {
      bodyLength = contentLength
      // Parse the body (and eventually process)
      captureBody(nextBuffer)
    } else {
      // Process the (header-only) content
      processMessage(headers, Buffer.alloc(0))
      headers = new Headers()
      // Re-parse whatever data was left after these headers were fully consumed.
      captureHeaders(nextBuffer)
    }
  }

  /* Read the socket using an async iterator */
  await socket.forEach((data: Buffer) => {
    if (bodyLength > 0) {
      captureBody(data)
    } else {
      captureHeaders(data)
    }
  })

  if (buffersLength > 0) {
    socket.emit(
      'warning',
      new FreeSwitchParserError(
        'Buffer is not empty at end of stream',
        Buffer.concat(buffers)
      )
    )
  }
}

// Headers parser
// ==============

// Event Socket framing contains headers and a body.
// The header must be decoded first to learn the presence and length of the body.
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
