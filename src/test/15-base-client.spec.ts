import { after, before, describe, it } from 'node:test'

import {
  start,
  stop,
  clientLogger as logger,
  clientLogger,
  onceConnected,
} from './utils.js'

import * as legacyESL from 'esl'

import { v4 as uuidv4 } from 'uuid'

import { second, sleep, timer, optionsText } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'
import assert from 'node:assert'
import { inspect } from 'node:util'

const domain = '127.0.0.1:5062'

// Client and server interaction
// -----------------------------

// These tests are long-runners.
let server: legacyESL.FreeSwitchServer

const cps = 2

const clientPort = 8024

describe('15-base-client.spec', () => {

before(start, { timeout: 12*second })
after(stop, { timeout: 12*second })

before(async function () {
  const service = async function (
    call: legacyESL.FreeSwitchResponse,
    { data }: { data: legacyESL.StringMap }
  ): Promise<void> {
    const destination = data['variable_sip_req_user']
    console.info('received call', destination)
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
        console.info(`Invalid destination ${destination}`)
        throw new Error(`Invalid destination ${destination}`)
    }
  }
  server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: clientLogger(),
  })
  server.on('connection', function (call, args: { data: legacyESL.StringMap }) {
    ;(async function () {
      // console.info('Server-side', call, args)
      try {
        await service(call, args)
      } catch (err) {
        console.info('Server-side error', err)
      }
    })().catch( console.error )
  })
  await server.listen({
    port: 7000,
  })
})

after(async function () {
  await sleep(8 * second)
  const count = await server.getConnectionCount()
  if (count > 0) {
    throw new Error(`Oops, ${count} active connections leftover`)
  }
  await server?.close()
}, { timeout: 10 * second })

void it('15-base-client: should detect leg_progress_timeout', { timeout: 4 * second }, async function () {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(),
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
  if (res instanceof Error) {
    throw res
  } else {
    assert.strictEqual(res.body.response, '-ERR PROGRESS_TIMEOUT\n')
  }
})

void it('15-base-client: should detect leg_timeout', { timeout: 4 * second }, async function () {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(),
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
  if (res instanceof Error) {
    throw res
  } else {
    assert.strictEqual(res.body.response, '-ERR ALLOTTED_TIMEOUT\n')
  }
})

void it('15-base-client: should detect hangup', { timeout: 18 * second }, async function () {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(),
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
      assert(d > 14 * second)
      assert(d < 16 * second)
    }
  })
  await service.bgapi(
    `originate [${optionsText(options)}]sofia/test-client/sip:answer-wait-15000@${domain} &park`,
    16_000
  )
  await sleep(16 * second)
  client.end()
})

// This is a simple test to make sure the client can work with both legs.
const count = 40
void it('15-base-client: should work with simple routing', { timeout: (4000 * count) / cps }, async function (t) {
  let sent = 0
  let caughtClient = 0
  let outcome = undefined
  const newCall = function (): void {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(),
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
          outcome = 'failed'
          caughtClient++
          t.diagnostic(`Caught ${caughtClient} client errors: ${inspect(error)}`)
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
  assert(sent / 2 === count)
  if (outcome != null) {
    throw new Error(outcome)
  }
})
})
