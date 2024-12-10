import { after, before, describe, it } from 'node:test'

import { startServer, stop, clientLogger, serverLogger } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import assert from 'node:assert'
import { second, sleep } from '../sleep.js'

// Using UUID (in client mode)
// ---------------------------
void describe('10-uuid.spec', () => {
  before(() => startServer(), { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  const serverPort = 8022

  const domain = '127.0.0.1:5062'

  const sLogger = serverLogger()
  const server = new FreeSwitchClient({
    logger: sLogger,
    port: serverPort,
  })

  let count = 0
  server.on('CHANNEL_CREATE', () => count++ )
  server.on('CHANNEL_HANGUP_COMPLETE', () => count-- )

  before(async () => {
    server.on('CHANNEL_CREATE', (call): void => {
      const direction = call.body.data['Call-Direction']
      if (direction !== 'inbound') {
        return
      }
      const uniqueId = call.body.uniqueID
      if (uniqueId == null) {
        sLogger.error(call, 'No uniqueID')
        return
      }
      void (async function () {
        try {
          const destination = call.body.data['variable_sip_req_user']
          sLogger.info({ destination }, 'Service started')
          switch (destination) {
            case 'answer-wait-30000':
              sLogger.info('Service answer')
              await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
              sLogger.info('Service wait 30s')
              await sleep(30 * second)
              break
            default:
              sLogger.info(call, 'Invalid destination')
          }
          sLogger.info('Service hanging up')
          await server.hangup_uuid(uniqueId, '200', 1_000)
          sLogger.info('Service hung up')
        } catch (ex) {
          sLogger.error({ err: ex })
        }
      })()
    })
  })

  after(
    async () => {
      await sleep(7 * second)
      server.end()
      assert.strictEqual(count, 0, `Oops, ${count} active connections leftover`)
      sLogger.info('Service closed')
    },
    { timeout: 10 * second }
  )

  void it(
    'should handle UUID-based commands',
    { timeout: 20 * second },
    async () => {
      const logger = clientLogger()
      const client = new FreeSwitchClient({
        port: serverPort,
        logger,
      })
      const originationUUID = '1829'
      const res1 = await client.bgapi(
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
      const res2 = await client.command_uuid(
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

  void it('should map sequential responses', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    const res1 = await client.bgapi('create_uuid', 100)
    let outcome = undefined
    if (res1 instanceof Error) {
      outcome = res1
    } else {
      const uuid1 = res1.body.response
      const res2 = await client.bgapi('create_uuid', 100)
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

  void it('should map sequential responses (using bgapi)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    const res1 = await client.bgapi('create_uuid', 100)
    let outcome = undefined
    if (res1 instanceof Error) {
      outcome = res1
    } else {
      const uuid1 = res1.body.response
      const res2 = await client.bgapi('create_uuid', 100)
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

  void it('should map sequential responses (sent in parallel)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    let uuid1: string | undefined
    let uuid2: string | undefined
    const p1 = client.bgapi('create_uuid', 200).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      if (typeof res.body.response === 'string') {
        uuid1 = res.body.response
      }
      return null
    })
    const p2 = client.bgapi('create_uuid', 200).then((res): null => {
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

  void it('should work with parallel responses (using bgapi)', async function () {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    let uuid1 = null
    let uuid2 = null
    const p1 = client.bgapi('create_uuid', 100).then((res): null => {
      if (res instanceof Error) {
        throw res
      }
      assert.strictEqual(typeof res.body.response, 'string')
      uuid1 = res.body.response
      return null
    })
    const p2 = client.bgapi('create_uuid', 100).then((res): null => {
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

  void it('should handle errors', { timeout: 2000 }, async function (t) {
    const client = new FreeSwitchClient({
      port: serverPort,
      logger: clientLogger(),
    })
    const originationUUID = 'ABCD'
    await client.bgapi(
      `originate {origination_uuid=${originationUUID}}sofia/test-server/sip:answer-wait-30000@${domain} &park`,
      2000
    )
    const ref = process.hrtime.bigint()
    const p = (async () => {
      // parallel
      const res = await client.command_uuid(
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
        t.diagnostic('OK')
      } else {
        throw new Error('invalid content')
      }
    })()
    await sleep(1000)
    await client.hangup_uuid(originationUUID, 'NO_PICKUP', 1_000)
    await sleep(500)
    client.end()
    await p
  })
})
