import { after, before, describe, it } from 'node:test'

import { FreeSwitchClient } from '../esl-lite.js'

import { start, stop, clientLogger } from './utils.js'

import { second } from '../sleep.js'
import { ulid } from 'ulidx'
import assert from 'node:assert'

const domain = '127.0.0.1:5062'
const clientPort = 8024

void describe('20-multiline-set.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  void it(
    'should process multiline argument',
    { timeout: 7000 },
    async (t): Promise<void> => {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const id = ulid()
      await client.bgapi(
        `originate {origination_uuid=${id}}sofia/test-client/sip:default@${domain} &park`,
        1_000
      )

      const value = `application/foo:
        Some weird value here.
      `
      await client.command_uuid(id, 'set', `sip_multipart=${value}`, 1_000)
      const res = await client.bgapi(`uuid_getvar ${id} sip_multipart`, 1_000)
      await client.bgapi(`uuid_kill ${id}`, 1_000)
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(res.body.response, value)
      t.diagnostic(`Received ${res.body.response}`)
      client.end()
    }
  )
})
