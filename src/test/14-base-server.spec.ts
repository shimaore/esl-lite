import test from 'node:test'

import {
  start,
  stop,
  clientLogger,
  serverLogger,
  DoCatch,
  onceConnected,
} from './utils.js'

import * as legacyESL from 'esl'

import { second, sleep } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'

const domain = '127.0.0.1:5062'

// Tests of the `server` part
// ==========================

// Server startup and connectivity
// -------------------------------

let server: legacyESL.FreeSwitchServer | null = null

const clientPort = 8024

const ev = new legacyESL.FreeSwitchEventEmitter()

test.before('14-base-server: start service', async function (t) {
  const service = async function (
    call: legacyESL.FreeSwitchResponse,
    { data }: { data: legacyESL.StringMap }
  ): Promise<void> {
    t.log({ data })
    const destination = data['variable_sip_req_user']
    t.log('service to', destination)
    switch (destination) {
      case 'answer-wait-3020': {
        await call.command('answer')
        await sleep(3000)
        await call.command('hangup', '200 answer-wait-3020')
        break
      }
      case 'server7002': {
        const res = await call.command('answer')
        t.is(res.body['Channel-Call-State'], 'ACTIVE')
        await call.command('hangup', '200 server7002')
        ev.emit('server7002')
        break
      }
      case 'server7003': {
        const res = await call.command('answer')
        t.is(res.body['Channel-Call-State'], 'ACTIVE')
        await call.command('hangup', '200 server7003')
        ev.emit('server7003')
        break
      }
      case 'server7008': {
        call.once('cleanup_linger', () => {
          ev.emit('server7008')
          call.end()
        })
        await call.linger()
        await call.command('answer')
        await sleep(1000)
        await call.command('hangup', '200 server7008')
        break
      }
      default:
        t.log(`Invalid destination ${destination}`)
    }
    call.end()
  }
  server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: serverLogger(t),
  })
  server.on('connection', function (call, args) {
    t.log('service received connection')
    DoCatch(t, async () => {
      t.log('Server-side', call, args)
      try {
        await service(call, args)
      } catch (err) {
        t.log('Server-side error', err)
      }
    })
  })
  await server.listen({
    host: '127.0.0.1',
    port: 7000,
  })
  t.log('Service up')
  t.pass()
})

test.after('14-base-server: stop service', async function (t) {
  t.timeout(10 * second)
  await sleep(8 * second)
  const count = await server?.getConnectionCount()
  if (count == null || count > 0) {
    t.fail(`Oops, ${count} active connections leftover`)
  }
  await server?.close()
  t.log('Service down', server?.stats)
  server = null
  t.pass()
})

test.before(start, { timeout: 12*second })
test.after.always(stop)

test('14-base-server: should handle one call', async function (t) {
  t.timeout(5 * second)
  t.plan(1)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  ev.on('server7002', function () {
    client.end()
    t.pass()
  })
  await service.bgapi(
    `originate sofia/test-client/sip:server7002@${domain} &bridge(sofia/test-client/sip:answer-wait-3020@${domain})`,
    4000
  )
  await sleep(3500)
})

test('14-base-server: should handle one call (bgapi)', async function (t) {
  t.timeout(4 * second)
  t.plan(1)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  ev.on('server7003', function () {
    client.end()
    t.pass()
  })
  await service.bgapi(
    `originate sofia/test-client/sip:server7003@${domain} &bridge(sofia/test-client/sip:answer-wait-3020@${domain})`,
    4000
  )
  await sleep(3500)
})

// The `exit` command normally triggers automatic cleanup for linger
// -----------------------------------------------------------------

// Automatic cleanup should trigger a `cleanup_linger` event if we're using linger mode.
test('14-base-server: should linger on exit', async function (t) {
  t.timeout(4 * second)
  t.plan(1)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  ev.on('server7008', function () {
    client.end()
    t.pass()
  })
  try {
    await service.bgapi(
      `originate sofia/test-client/sip:server7008@${domain} &hangup`,
      4000
    )
  } catch (err) {
    t.log('responded with', err)
  }
  await sleep(3500)
})
