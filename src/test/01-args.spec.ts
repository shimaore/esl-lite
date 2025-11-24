import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  defaults,
  FreeSwitchApplicationEndedError,
  FreeSwitchResponse,
} from '../esl-lite.js'
import { responseLogger } from './utils.js'
import { EslLite } from '../lite.js'
import { sleep } from '../sleep.js'
import { inspect } from 'node:util'
import pino from 'pino'

class FreeSwitchResponseProxy extends FreeSwitchResponse {
  public constructor(lite: EslLite, password: string, logger: pino.Logger) {
    super(lite, password, logger)
  }
  public async forceConnect() {
    await this.connect()
  }
}

void describe('01-args', async () => {
  void it(
    '01-args: should report properly on end',
    { timeout: 5_000 },
    async function (t) {
      const lite = new EslLite({
        ...defaults,
        logger: pino({ name: '01-args' }),
      })
      const client = new FreeSwitchResponseProxy(
        lite,
        defaults.password,
        responseLogger()
      )
      client.forceConnect().catch((err: unknown) => {
        t.diagnostic(inspect(err))
      })
      await sleep(2_000)
      client.end()
      assert.strictEqual(
        client.stats.nonEmptyBufferAtEnd,
        0n,
        'Buffer should be empty at end of stream'
      )
    }
  )

  void it(
    '01-args: should report properly on closed (bgapi)',
    { timeout: 5_000 },
    async function (t) {
      const lite = new EslLite({
        ...defaults,
        logger: pino({ name: '01-args' }),
      })
      const client = new FreeSwitchResponseProxy(
        lite,
        defaults.password,
        responseLogger()
      )
      client.forceConnect().catch((err: unknown) => {
        t.diagnostic(inspect(err))
      })
      setTimeout(() => {
        client.end()
      }, 2_000)
      const res = await client.bgapi('foo', 1000)
      t.diagnostic('bgapi foo returned ' + inspect(res))
      assert(
        res instanceof FreeSwitchApplicationEndedError,
        'Expected FreeSwitchApplicationEnded'
      )
      assert.strictEqual(
        client.stats.nonEmptyBufferAtEnd,
        0n,
        'Buffer should be empty at end of stream'
      )
    }
  )
})
