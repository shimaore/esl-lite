import { after, before, describe, it } from 'node:test'

import { start, stop, clientLogger, serverLogger } from './utils.js'

import { FreeSwitchClient, FreeSwitchEventEmitter } from '../esl-lite.js'
import { second, sleep } from '../sleep.js'
import assert from 'node:assert'
import { inspect } from 'node:util'

const domain = '127.0.0.1:5062'

// Tests of the `server` part
// ==========================

// Server startup and connectivity
// -------------------------------

const serverPort = 8022
const sLogger = serverLogger()
const server = new FreeSwitchClient({
  logger: sLogger,
  port: serverPort,
})

const clientPort = 8024

void describe('14-base-server.spec', () => {
  const ev = new FreeSwitchEventEmitter<
    'server7002' | 'server7003' | 'server7008',
    {
      server7002: () => void
      server7003: () => void
      server7008: () => void
    }
  >()

  let count = 0

  before(async function () {
    server.on('CHANNEL_CREATE', (call) => {
      const direction = call.body.data['Call-Direction']
      if (direction !== 'inbound') {
        return
      }
      const uniqueId = call.body.uniqueID
      if (uniqueId == null) {
        sLogger.error(call, 'No uniqueID')
        return
      }
      ;(async () => {
        count++
        // console.info({ data })
        const destination = call.body.data['variable_sip_req_user']
        console.info('service to', destination)
        switch (destination) {
          case 'answer-wait-3020': {
            await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
            await sleep(3000)
            await server.command_uuid(
              uniqueId,
              'hangup',
              '200 answer-wait-3020',
              1_000
            )
            break
          }
          case 'server7002': {
            const res = await server.command_uuid(
              uniqueId,
              'answer',
              undefined,
              1_000
            )
            if (res instanceof Error) {
              sLogger.error({ err: res })
              throw res
            } else {
              assert.strictEqual(res.body.data['Channel-Call-State'], 'ACTIVE')
            }
            await server.command_uuid(
              uniqueId,
              'hangup',
              '200 server7002',
              1_000
            )
            ev.emit('server7002', undefined)
            break
          }
          case 'server7003': {
            const res = await server.command_uuid(
              uniqueId,
              'answer',
              undefined,
              1_000
            )
            if (res instanceof Error) {
              sLogger.error({ err: res })
              throw res
            } else {
              assert.strictEqual(res.body.data['Channel-Call-State'], 'ACTIVE')
            }
            await server.command_uuid(
              uniqueId,
              'hangup',
              '200 server7003',
              1_000
            )
            ev.emit('server7003', undefined)
            break
          }
          case 'server7008': {
            await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
            await sleep(1000)
            await server.command_uuid(
              uniqueId,
              'hangup',
              '200 server7008',
              1_000
            )
            ev.emit('server7008', undefined)
            break
          }
          default:
            sLogger.error({ destination }, 'Invalid destination')
        }
        count--
      })().catch((ex: unknown) => {
        sLogger.error({ err: ex })
      })
    })
  })

  after(
    async function () {
      await sleep(8 * second)
      server.end()
      console.info('Service down', server?.stats)
      if (count == null || count > 0) {
        throw new Error(`Oops, ${count} active connections leftover`)
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
      ev.on('server7002', function () {
        client.end()
        expectedOutcome--
      })
      await client.bgapi(
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
      ev.on('server7003', function () {
        client.end()
        expectedOutcome--
      })
      await client.bgapi(
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
      ev.on('server7008', function () {
        client.end()
        expectedOutcome--
      })
      try {
        await client.bgapi(
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
