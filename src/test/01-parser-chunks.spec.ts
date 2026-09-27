import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { FreeSwitchParser } from '../parser.js'
import { dummyLogger } from './utils.js'

type Frame =
  | {
      contentType: string | undefined
      replyText: string | undefined
      body: string
    }
  | { error: string }

const eventBody = `Event-Name: CHANNEL_ANSWER
Unique-ID: 7f4de4bc-1b3a-4a5e-9f3d-2c1f5c9d0a11
Answer-State: answered

`

const frames = [
  `Content-Type: auth/request

`,
  `Content-Type: command/reply
Reply-Text: +OK accepted

`,
  `Content-Type: text/event-plain
Content-Length: ${Buffer.byteLength(eventBody)}

${eventBody}`,
  `Content-Type: api/response
Content-Length: 3

+OK`,
  `Content-Type: command/reply
Reply-Text: +OK event listener enabled plain

`,
]

const stream = Buffer.from(frames.join(''))

const parse = async function (chunks: Buffer[]): Promise<Frame[]> {
  const socket = async function* (): AsyncGenerator<Buffer> {
    for (const chunk of chunks) {
      yield chunk
      await Promise.resolve()
    }
  }
  const result: Frame[] = []
  for await (const frame of FreeSwitchParser(socket(), dummyLogger())) {
    if (frame instanceof Error) {
      result.push({ error: frame.name })
    } else {
      result.push({
        contentType: frame.headers.contentType,
        replyText: frame.headers.replyText,
        body: frame.body.toString(),
      })
    }
  }
  return result
}

const splitAt = function (buffer: Buffer, cuts: number[]): Buffer[] {
  const chunks: Buffer[] = []
  let start = 0
  for (const cut of cuts) {
    chunks.push(buffer.subarray(start, cut))
    start = cut
  }
  chunks.push(buffer.subarray(start))
  return chunks
}

void describe('01-parser-chunks', () => {
  void it('01-parser-chunks: parses the stream in one chunk', async () => {
    const result = await parse([stream])
    assert.equal(result.length, frames.length)
    assert.deepEqual(result[2], {
      contentType: 'text/event-plain',
      replyText: undefined,
      body: eventBody,
    })
    assert.deepEqual(result[3], {
      contentType: 'api/response',
      replyText: undefined,
      body: '+OK',
    })
  })

  void it('01-parser-chunks: header terminator split between chunks', async () => {
    const expected = await parse([stream])
    /* Cut between the two newlines of each frame's header terminator. */
    let offset = 0
    for (const frame of frames) {
      const cut = offset + frame.indexOf('\n\n') + 1
      assert.deepEqual(
        await parse(splitAt(stream, [cut])),
        expected,
        `split at ${cut}`
      )
      offset += Buffer.byteLength(frame)
    }
  })

  void it('01-parser-chunks: split at every position', async () => {
    const expected = await parse([stream])
    for (let cut = 1; cut < stream.length; cut++) {
      assert.deepEqual(
        await parse(splitAt(stream, [cut])),
        expected,
        `split at ${cut}`
      )
    }
  })

  void it('01-parser-chunks: one-byte chunks', async () => {
    const expected = await parse([stream])
    const chunks: Buffer[] = []
    for (let i = 0; i < stream.length; i++) {
      chunks.push(stream.subarray(i, i + 1))
    }
    assert.deepEqual(await parse(chunks), expected)
  })
})
