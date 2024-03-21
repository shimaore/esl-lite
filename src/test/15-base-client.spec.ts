import test from 'ava'

import {
  start,
  stop,
  clientLogger as logger,
  clientLogger,
  DoCatch,
  onceConnected,
} from './utils.js'

import * as legacyESL from 'esl'

import { v4 as uuidv4 } from 'uuid'

import { second, sleep, timer, optionsText } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'

const domain = '127.0.0.1:5062'

// Client and server interaction
// -----------------------------

// These tests are long-runners.
let server: legacyESL.FreeSwitchServer

const cps = 2

const clientPort = 8024

test.before(start)
test.after.always(stop)

test.before('15-base-client: start service', async function (t) {
  const service = async function (
    call: legacyESL.FreeSwitchResponse,
    { data }: { data: legacyESL.StringMap }
  ): Promise<void> {
    const destination = data['variable_sip_req_user']
    t.log('received call', destination)
    switch (destination) {
      case 'answer-wait-15000':
        await call.command('answer')
        await sleep(15 * second)
        await call.command('hangup', '200 answer-wait-15000')
        break
      case 'wait-15000-answer':
        await sleep(15 * second)
        await call.command('answer')
        await sleep(1 * second)
        await call.command('hangup', '200 answer-wait-15000')
        break
      case 'answer-wait-3000':
        await call.command('answer')
        await sleep(3 * second)
        await call.command('hangup', '200 answer-wait-3000').catch(() => true)
        break
      default:
        t.log(`Invalid destination ${destination}`)
        throw new Error(`Invalid destination ${destination}`)
    }
  }
  server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: clientLogger(t),
  })
  server.on('connection', function (call, args: { data: legacyESL.StringMap }) {
    DoCatch(t, async function () {
      t.log('Server-side', call, args)
      try {
        await service(call, args)
      } catch (err) {
        t.log('Server-side error', err)
      }
    })
  })
  await server.listen({
    port: 7000,
  })
})

test.after.always(async function (t) {
  t.timeout(10 * second)
  await sleep(8 * second)
  const count = await server.getConnectionCount()
  if (count > 0) {
    throw new Error(`Oops, ${count} active connections leftover`)
  }
  await server?.close()
  t.pass()
})

test('15-base-client: should detect leg_progress_timeout', async function (t) {
  t.timeout(4 * second)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_progress_timeout: 1,
    tracer_uuid: id,
  }
  const res = await service.bgapi(
    `originate [${optionsText(options)}]sofia/test-client/sip:wait-15000-answer@${domain} &park`,
    15000
  )
  client.end()
  t.is(res.headers.replyText, '-ERR PROGRESS_TIMEOUT\n')
})

test('15-base-client: should detect leg_timeout', async function (t) {
  t.timeout(4 * second)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_timeout: 2,
    tracer_uuid: id,
  }
  const res = await service.bgapi(
    `originate [${optionsText(options)}]sofia/test-client/sip:wait-15000-answer@${domain} &park`,
    15000
  )
  client.end()
  t.is(res.headers.replyText, '-ERR ALLOTTED_TIMEOUT\n')
})

test('15-base-client: should detect hangup', async function (t) {
  t.timeout(18 * second)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    tracer_uuid: id,
  }
  const duration = timer()
  service.on('CHANNEL_HANGUP', function (msg) {
    if (msg.body.data['variable_tracer_uuid'] === id) {
      const d = duration()
      t.true(d > 14 * second)
      t.true(d < 16 * second)
    }
  })
  await service.event_json(['CHANNEL_HANGUP'])
  await service.bgapi(
    `originate [${optionsText(options)}]sofia/test-client/sip:answer-wait-15000@${domain} &park`,
    16_000
  )
  await sleep(16 * second)
  client.end()
})

// This is a simple test to make sure the client can work with both legs.
test('15-base-client: should work with simple routing', async function (t) {
  const count = 40
  let sent = 0
  t.timeout((4000 * count) / cps)
  let caughtClient = 0
  const newCall = function (): void {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(t),
    })
    client.on('connect', function (call): void {
      void (async function () {
        try {
          await call.bgapi(
            `originate sofia/test-client/sip:answer-wait-3000@${domain} &bridge(sofia/test-client/sip:answer-wait-3000@${domain})`,
            4000
          )
          sent += 2
          await sleep(4000)
          client.end()
        } catch (error) {
          t.fail()
          caughtClient++
          t.log(`Caught ${caughtClient} client errors.`, error)
        }
      })()
    })
    client.connect()
  }
  for (
    let i = 1, j = 1, ref = count;
    ref >= 1 ? j <= ref : j >= ref;
    i = ref >= 1 ? ++j : --j
  ) {
    setTimeout(newCall, (i * second) / cps)
  }
  await sleep((4000 * count) / cps - 500)
  t.true(sent / 2 === count)
})
