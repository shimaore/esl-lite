import { after, before, describe, it } from 'node:test'

import {
  start,
  stop,
  clientLogger,
  serverLogger,
  onceConnected,
} from './utils.js'

import * as legacyESL from 'esl'

import { second, sleep } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'
import assert from 'node:assert'
import { inspect } from 'node:util'

const domain = '127.0.0.1:5062'

// Tests of the `server` part
// ==========================

// Server startup and connectivity
// -------------------------------

let server: legacyESL.FreeSwitchServer | null = null

const clientPort = 8024

void describe('14-base-server.spec', () => {
  const ev = new legacyESL.FreeSwitchEventEmitter()

  before(async function () {
    const service = async function (
      call: legacyESL.FreeSwitchResponse,
      { data }: { data: legacyESL.StringMap }
    ): Promise<void> {
      // console.info({ data })
      const destination = data['variable_sip_req_user']
      console.info('service to', destination)
      switch (destination) {
        case 'answer-wait-3020': {
          await call.command('answer')
          await sleep(3000)
          await call.command('hangup', '200 answer-wait-3020')
          break
        }
        case 'server7002': {
          const res = await call.command('answer')
          assert.strictEqual(res.body['Channel-Call-State'], 'ACTIVE')
          await call.command('hangup', '200 server7002')
          ev.emit('server7002')
          break
        }
        case 'server7003': {
          const res = await call.command('answer')
          assert.strictEqual(res.body['Channel-Call-State'], 'ACTIVE')
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
          console.error(`Invalid destination ${destination}`)
      }
      call.end()
    }
    server = new legacyESL.FreeSwitchServer({
      all_events: false,
      logger: serverLogger(),
    })
    server.on('connection', function (call, args) {
      console.info('service received connection')
      ;(async () => {
        // console.info('Server-side', call, args)
        try {
          await service(call, args)
        } catch (err) {
          console.info('Server-side error', err)
        }
      })().catch(console.error)
    })
    await server.listen({
      host: '127.0.0.1',
      port: 7000,
    })
    console.info('Service up')
  })

  after(
    async function () {
      await sleep(8 * second)
      const count = await server?.getConnectionCount()
      let outcome = undefined
      if (count == null || count > 0) {
        outcome = `Oops, ${count} active connections leftover`
      }
      await server?.close()
      console.info('Service down', server?.stats)
      server = null
      if (outcome != null) {
        throw new Error(outcome)
      }
    },
    { timeout: 10 * second }
  )

  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  void it(
    '14-base-server: should handle one call',
    { timeout: 5 * second },
    async function () {
      let expectedOutcome = 1
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const p = onceConnected(client)
      client.connect()
      const service = await p
      ev.on('server7002', function () {
        client.end()
        expectedOutcome--
      })
      await service.bgapi(
        `originate sofia/test-client/sip:server7002@${domain} &bridge(sofia/test-client/sip:answer-wait-3020@${domain})`,
        4000
      )
      await sleep(3500)
      if (expectedOutcome !== 0) {
        throw new Error(`failed`)
      }
    }
  )

  void it(
    '14-base-server: should handle one call (bgapi)',
    { timeout: 4 * second },
    async function () {
      let expectedOutcome = 1
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const p = onceConnected(client)
      client.connect()
      const service = await p
      ev.on('server7003', function () {
        client.end()
        expectedOutcome--
      })
      await service.bgapi(
        `originate sofia/test-client/sip:server7003@${domain} &bridge(sofia/test-client/sip:answer-wait-3020@${domain})`,
        4000
      )
      await sleep(3500)
      if (expectedOutcome !== 0) {
        throw new Error(`failed`)
      }
    }
  )

  // The `exit` command normally triggers automatic cleanup for linger
  // -----------------------------------------------------------------

  // Automatic cleanup should trigger a `cleanup_linger` event if we're using linger mode.
  void it(
    '14-base-server: should linger on exit',
    { timeout: 4 * second },
    async function (t) {
      let expectedOutcome = 1
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const p = onceConnected(client)
      client.connect()
      const service = await p
      ev.on('server7008', function () {
        client.end()
        expectedOutcome--
      })
      try {
        await service.bgapi(
          `originate sofia/test-client/sip:server7008@${domain} &hangup`,
          4000
        )
      } catch (err) {
        t.diagnostic(`responded with ${inspect(err)}`)
      }
      await sleep(3500)
      if (expectedOutcome !== 0) {
        throw new Error(`failed`)
      }
    }
  )
})
