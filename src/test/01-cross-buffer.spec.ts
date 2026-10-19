import { it } from 'node:test'
import { FreeSwitchParser } from '../parser.js'

import { clientLogger } from './utils.js'
import assert from 'node:assert'

void it('01-cross-buffer-spec: parse single buffer, no length', async () => {
  const logger = clientLogger()
  const generator = async function* () {
    yield Buffer.from("Name: a\n\n")
  }
  let rank = 0
  for await (const output of FreeSwitchParser(generator(), logger)) {
    if (output instanceof Error) throw output
    rank++
    console.log(rank, output)
    if (rank === 1) {
      assert.strictEqual(output.headers.get('Name'),'a')
      assert.strictEqual(output.headers.contentLength,undefined)
    }
  }
  assert.strictEqual(rank,1)
})

void it('01-cross-buffer-spec: parse single buffers', async () => {
  const logger = clientLogger()
  const generator = async function* () {
    yield Buffer.from("Name: a\nContent-Length: 0\n\n")
  }
  let rank = 0
  for await (const output of FreeSwitchParser(generator(), logger)) {
    if (output instanceof Error) throw output
    rank++
    console.log(rank, output)
    if (rank === 1) {
      assert.strictEqual(output.headers.get('Name'),'a')
      assert.strictEqual(output.headers.contentLength,0)
    }
  }
  assert.strictEqual(rank,1)
})

void it('01-cross-buffer-spec: parse regular buffers', async () => {
  const logger = clientLogger()
  const generator = async function* () {
    yield Buffer.from("Name: a\nContent-Length: 0\n\n")
    yield Buffer.from("Name: b\nContent-Length: 1\n\n")
    yield Buffer.from("b")
  }
  let rank = 0
  for await (const output of FreeSwitchParser(generator(), logger)) {
    if (output instanceof Error) throw output
    rank++
    console.log(rank, output)
    if (rank === 1) {
      assert.strictEqual(output.headers.get('Name'),'a')
      assert.strictEqual(output.headers.contentLength,0)
    }
    if (rank === 2) {
      assert.strictEqual(output.headers.get('Name'),'b')
      assert.strictEqual(output.headers.contentLength,1)
      assert.strictEqual(output.body.toString(),'b')
    }
  }
  assert.strictEqual(rank,2)
})

void it('01-cross-buffer-spec: parse across buffers', async () => {
  const logger = clientLogger()
  const generator = async function* () {
    yield Buffer.from("Name: a\nContent-Length: 0\n")
    yield Buffer.from("\nName: b\nContent-Length: 1\n")
    yield Buffer.from("\nb")
  }
  let rank = 0
  for await (const output of FreeSwitchParser(generator(), logger)) {
    if (output instanceof Error) throw output
    rank++
    console.log(rank, output)
    if (rank === 1) {
      assert.strictEqual(output.headers.get('Name'),'a')
      assert.strictEqual(output.headers.contentLength,0)
    }
    if (rank === 2) {
      assert.strictEqual(output.headers.get('Name'),'b')
      assert.strictEqual(output.headers.contentLength,1)
      assert.strictEqual(output.body.toString(),'b')
    }
  }
  assert.strictEqual(rank,2)
})
