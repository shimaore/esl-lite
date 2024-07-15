import test from 'node:test'

import * as legacyESL from 'esl'

import {
  startServer,
  stop,
  clientLogger,
  serverLogger,
  onceConnected,
} from './utils.js'
import { second, sleep } from './tools.js'
import { FreeSwitchClient, type FreeSwitchResponse } from '../esl-lite.js'
import assert from 'node:assert'

// Using UUID (in client mode)
// ---------------------------
test.before(() => startServer(), { timeout: 12*second })
test.after(stop)

const serverPort = 8022

const domain = '127.0.0.1:5062'

let server: legacyESL.FreeSwitchServer | null = null
test.before(async (t) => {
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
        console.log('Service started', { destination })
        switch (destination) {
          case 'answer-wait-30000':
            console.log('Service answer')
            await call.command('answer')
            console.log('Service wait 30s')
            await sleep(30 * second)
            break
          default:
            console.log(`Invalid destination ${destination}`)
        }
        console.log('Service hanging up')
        await call.hangup()
        console.log('Service hung up')
      } catch (ex) {
        console.error(ex)
      }
    })()
  }

  server.on('connection', service)

  server.on('error', function (error) {
    console.log('Service', error)
  })

  await server.listen({
    port: 7000,
  })
})

test.after(async () => {
  await sleep(7 * second)
  const count = await server?.getConnectionCount()
  await server?.close()
  assert.strictEqual(count, 0, `Oops, ${count} active connections leftover`)
  console.log('Service closed')
}, { timeout: 10 * second })

test('should handle UUID-based commands', async () => {
  const logger = clientLogger()
  const client = new FreeSwitchClient({
    port: serverPort,
    logger,
  })
  client.connect()
  const call = await onceConnected(client)
  await call.event_json(['ALL'])
  const originationUUID = '1829'
  const res1 = await call.bgapi(
    `originate {origination_uuid=${originationUUID},origination_channel_name='1234'}sofia/test-server/sip:answer-wait-30000@${domain} &park`,
    20000
  )
  let outcome = undefined
  if (res1 instanceof Error) {
    outcome = res1
  } else {
    console.log(res1.body.response)
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
}, { timeout: 20*second })

test('should map sequential responses', async function () {
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

test('should map sequential responses (using bgapi)', async function () {
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

test('should map sequential responses (sent in parallel)', async function (t) {
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  client.connect()
  const call = await onceConnected(client)
  let uuid1: string | undefined
  let uuid2: string | undefined
  const p1 = call.bgapi('create_uuid', 200).then((res): null => {
    if (res instanceof Error) {
      return t.fail(res.message)
    }
    t.is(typeof res.body.response, 'string')
    if (typeof res.body.response === 'string') {
      uuid1 = res.body.response
    }
    return null
  })
  const p2 = call.bgapi('create_uuid', 200).then((res): null => {
    if (res instanceof Error) {
      return t.fail(res.message)
    }
    t.is(typeof res.body.response, 'string')
    if (typeof res.body.response === 'string') {
      uuid2 = res.body.response
    }
    return null
  })
  await Promise.all([p1, p2])
  client.end()
  t.true(uuid1 != null, 'Not sequential')
  t.true(uuid2 != null, 'Not sequential')
  t.not(uuid1, uuid2, 'UUIDs should be unique')
})

test('should work with parallel responses (using bgapi)', async function (t) {
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  client.connect()
  const call = await onceConnected(client)
  let uuid1 = null
  let uuid2 = null
  const p1 = call.bgapi('create_uuid', 100).then((res): null => {
    if (res instanceof Error) {
      return t.fail(res.message)
    }
    t.is(typeof res.body.response, 'string')
    uuid1 = res.body.response
    return null
  })
  const p2 = call.bgapi('create_uuid', 100).then((res): null => {
    if (res instanceof Error) {
      return t.fail(res.message)
    }
    t.is(typeof res.body.response, 'string')
    uuid2 = res.body.response
    return null
  })
  await Promise.all([p1, p2])
  client.end()
  t.true(uuid1 != null, 'Not sequential')
  t.true(uuid2 != null, 'Not sequential')
  t.not(uuid1, uuid2, 'UUIDs should be unique')
})

test('should handle errors', async function (t) {
  t.timeout(2000)
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  client.connect()
  const call = await onceConnected(client)
  await call.event_json(['ALL'])
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
    t.true(duration > 1000000000n)
    t.true(duration < 1200000000n)
    if (res instanceof Error) {
      return t.fail(res.message)
    }
    t.like(res.body.data, {
      'Answer-State': 'hangup',
      'Hangup-Cause': 'NO_PICKUP',
    })
  })()
  await sleep(1000)
  await call.hangup_uuid(originationUUID, 'NO_PICKUP')
  await sleep(500)
  client.end()
  await p
})

// Test DTMF
// ---------

// This test should work but I haven't taken the time to finalize it.
test.skip('should detect DTMF', async function (t) {
  t.timeout(9000)
  const server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: clientLogger(t),
  })
  server.on('connection', function (call) {
    void (async function () {
      try {
        await call.event_json('DTMF')
        await call.api('sofia global siptrace on')
        await call.command('answer')
        await call.command('start_dtmf')
        t.log('answered')
        await call.command('sleep', '10000')
        await sleep(10000)
        call.end()
      } catch (ex) {
        t.log(ex)
        t.fail()
      }
    })()
  })
  await server.listen({ port: 7012 })
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  client.on('connect', function (call: FreeSwitchResponse): void {
    void (async function () {
      try {
        let coreUUID = null
        call.on('CHANNEL_OUTGOING', function (msg) {
          coreUUID = msg.body.uniqueID
          t.log('CHANNEL_OUTGOING', { coreUUID })
        })
        await call.event_json(['ALL'])
        await call.bgapi('sofia status', 200)
        await call.bgapi('sofia global siptrace on', 200)
        const msg = await call.bgapi(
          `originate sofia/test-server/sip:server7012@${domain} &park`,
          9000
        )
        if (msg instanceof Error) {
          return t.fail(msg.message)
        }
        const $ = (msg.headers.replyText ?? 'NONE').match(/\+OK ([\da-f-]+)/)
        if ($ != null) {
          const channelUUID = $[1]
          t.log('originate', { channelUUID })
          await sleep(2000)
          const msg = await call.bgapi(
            `uuid_send_dtmf ${channelUUID} 1234`,
            4000
          )
          t.log('api', msg)
          await sleep(5000)
          t.pass()
        } else {
          t.fail()
        }
      } catch (ex) {
        t.log(ex)
        t.fail()
      }
    })()
  })
  client.connect()
})
