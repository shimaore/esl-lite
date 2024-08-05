import { after, before, describe, it } from 'node:test'

import * as legacyESL from 'esl'

import {
  startServer,
  stop,
  clientLogger,
  serverLogger,
  onceConnected,
} from './utils.js'
import { second, sleep } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'
import assert from 'node:assert'

// Using UUID (in client mode)
// ---------------------------
describe('10-uuid.spec', () => {
  before(() => startServer(), { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  const serverPort = 8022

  const domain = '127.0.0.1:5062'

  let server: legacyESL.FreeSwitchServer | null = null
  before(async () => {
    server = new legacyESL.FreeSwitchServer({
      all_events: true,
      my_events: false,
      logger: serverLogger(),
    })

    const service = function (
      call: legacyESL.FreeSwitchResponse,
      { data }: { data: legacyESL.StringMap }
    ): void {
      void (async function () {
        try {
          const destination = data['variable_sip_req_user']
          console.info('Service started', { destination })
          switch (destination) {
            case 'answer-wait-30000':
              console.info('Service answer')
              await call.command('answer')
              console.info('Service wait 30s')
              await sleep(30 * second)
              break
            default:
              console.info(`Invalid destination ${destination}`)
          }
          console.info('Service hanging up')
          await call.hangup()
          console.info('Service hung up')
        } catch (ex) {
          console.error(ex)
        }
      })()
    }

    server.on('connection', service)

    server.on('error', function (error) {
      console.error('Service', error)
    })

    await server.listen({
      port: 7000,
    })
  })

  after(
    async () => {
      await sleep(7 * second)
      const count = await server?.getConnectionCount()
      await server?.close()
      assert.strictEqual(count, 0, `Oops, ${count} active connections leftover`)
      console.info('Service closed')
    },
    { timeout: 10 * second }
  )

  it(
    'should handle UUID-based commands',
    { timeout: 20 * second },
    async () => {
      const logger = clientLogger()
      const client = new FreeSwitchClient({
        port: serverPort,
        logger,
      })
      client.connect()
      const call = await onceConnected(client)
      const originationUUID = '1829'
      const res1 = await call.bgapi(
        `originate {origination_uuid=${originationUUID},origination_channel_name='1234'}sofia/test-server/sip:answer-wait-30000@${domain} &park`,
        20000
      )
      let outcome = undefined
      if (res1 instanceof Error) {
        outcome = res1
      } else {
        console.info(res1.body.response)
        assert.strictEqual(res1.body.response, `+OK ${originationUUID}\n`)
      }
      await sleep(1000)
      const res2 = await call.command_uuid(
        originationUUID,
        'hangup',
        undefined,
        1000
      )
      if (res2 instanceof Error) {
        outcome = res2
      } else {
        assert.strictEqual(res2.body.data['Hangup-Cause'], 'NORMAL_CLEARING')
      }
      client.end()
      if (outcome instanceof Error) {
        throw outcome
      }
    }
  )

  it('should map sequential responses', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    client.connect()
    const call = await onceConnected(client)
    const res1 = await call.bgapi('create_uuid', 100)
    let outcome = undefined
    if (res1 instanceof Error) {
      outcome = res1
    } else {
      const uuid1 = res1.body.response
      const res2 = await call.bgapi('create_uuid', 100)
      if (res2 instanceof Error) {
        outcome = res2
      } else {
        const uuid2 = res2.body.response
        assert.strictEqual(typeof uuid1, 'string')
        assert.strictEqual(typeof uuid2, 'string')
        assert.notStrictEqual(uuid1, uuid2, 'UUIDs should be unique')
      }
    }
    client.end()
    if (outcome instanceof Error) {
      throw outcome
    }
  })

  it('should map sequential responses (using bgapi)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    client.connect()
    const call = await onceConnected(client)
    const res1 = await call.bgapi('create_uuid', 100)
    let outcome = undefined
    if (res1 instanceof Error) {
      outcome = res1
    } else {
      const uuid1 = res1.body.response
      const res2 = await call.bgapi('create_uuid', 100)
      if (res2 instanceof Error) {
        outcome = res2
      } else {
        const uuid2 = res2.body.response
        assert.notStrictEqual(uuid1, uuid2, 'UUIDs should be unique')
      }
    }
    client.end()
    if (outcome instanceof Error) {
      throw outcome
    }
  })

  it('should map sequential responses (sent in parallel)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    client.connect()
    const call = await onceConnected(client)
    let uuid1: string | undefined
    let uuid2: string | undefined
    const p1 = call.bgapi('create_uuid', 200).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      if (typeof res.body.response === 'string') {
        uuid1 = res.body.response
      }
      return null
    })
    const p2 = call.bgapi('create_uuid', 200).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      if (typeof res.body.response === 'string') {
        uuid2 = res.body.response
      }
      return null
    })
    await Promise.all([p1, p2])
    client.end()
    assert(uuid1 != null, 'Not sequential')
    assert(uuid2 != null, 'Not sequential')
    assert.notStrictEqual(uuid1, uuid2, 'UUIDs should be unique')
  })

  it('should work with parallel responses (using bgapi)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    client.connect()
    const call = await onceConnected(client)
    let uuid1 = null
    let uuid2 = null
    const p1 = call.bgapi('create_uuid', 100).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      uuid1 = res.body.response
      return null
    })
    const p2 = call.bgapi('create_uuid', 100).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      uuid2 = res.body.response
      return null
    })
    await Promise.all([p1, p2])
    client.end()
    assert(uuid1 != null, 'Not sequential')
    assert(uuid2 != null, 'Not sequential')
    assert.notStrictEqual(uuid1, uuid2, 'UUIDs should be unique')
  })

  it('should handle errors', { timeout: 2000 }, async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    client.connect()
    const call = await onceConnected(client)
    const originationUUID = 'ABCD'
    await call.bgapi(
      `originate {origination_uuid=${originationUUID}}sofia/test-server/sip:answer-wait-30000@${domain} &park`,
      2000
    )
    const ref = process.hrtime.bigint()
    const p = (async () => {
      // parallel
      const res = await call.command_uuid(
        originationUUID,
        'play_and_get_digits',
        '4 5 3 20000 # silence_stream://4000 silence_stream://4000 choice \\d 1000',
        4200
      )
      const now = process.hrtime.bigint()
      const duration = now - ref
      assert(duration > 1000000000n)
      assert(duration < 1200000000n)
      if (res instanceof Error) {
        throw res
      }
      if (
        'Answer-State' in res.body.data &&
        res.body.data['Answer-State'] === 'hangup' &&
        'Hangup-Cause' in res.body.data &&
        res.body.data['Hangup-Cause'] === 'NO_PICKUP'
      ) {
        true
      } else {
        throw new Error('invalid content')
      }
    })()
    await sleep(1000)
    await call.hangup_uuid(originationUUID, 'NO_PICKUP')
    await sleep(500)
    client.end()
    await p
  })
})
