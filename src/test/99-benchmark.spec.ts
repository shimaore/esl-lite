import { after, before, describe, it } from 'node:test'

import { FreeSwitchClient, FreeSwitchEventData } from '../esl-lite.js'

import { clientLogger, serverLogger, start, stop } from './utils.js'
import { second, sleep } from '../sleep.js'
import { inspect } from 'node:util'

const clientPort = 8024
const serverPort = 8022

const sLogger = serverLogger()
const server1 = new FreeSwitchClient({
  logger: sLogger,
  port: serverPort,
})
let s1Count = 0
server1.on('CHANNEL_CREATE', () => s1Count++)
server1.on('CHANNEL_HANGUP_COMPLETE', () => s1Count--)
const server2 = new FreeSwitchClient({
  logger: sLogger,
  port: serverPort,
})
let s2Count = 0
server2.on('CHANNEL_CREATE', () => s2Count++)
server2.on('CHANNEL_HANGUP_COMPLETE', () => s2Count--)

const domain = '127.0.0.1:5062'

const showReport = false

void describe('99-benchmark.spec', () => {
  before(start, { timeout: 12 * second })
  after(
    async () => {
      // Ava runs tests in parallel, so let's wait long enough for the other tests to
      // complete!
      await sleep(30 * second)
      await stop()
    },
    { timeout: 50 * second }
  )

  void it('should be reachable', { timeout: 35 * second }, async (t) => {
    const report = (): void => {
      t.diagnostic(
        inspect({
          server: server1.stats,
          server2: server2.stats,
          connection_count: s1Count,
          max_connections: s2Count,
          runs,
          sentCalls,
          receivedCalls,
          receivedCompletedCalls,
        })
      )
    }
    const timer = showReport ? setInterval(report, 1000) : undefined

    const receivedCalls = new Set()
    const receivedCompletedCalls = new Set()
    const serverHandler =
      (server: FreeSwitchClient) =>
      (call: FreeSwitchEventData): void => {
        const direction = call.body.data['Call-Direction']
        if (direction !== 'inbound') {
          return
        }
        const uniqueId = call.body.uniqueID
        if (uniqueId == null) {
          return
        }
        if (receivedCalls.has(uniqueId)) {
          return
        }
        receivedCalls.add(uniqueId)
        void (async () => {
          try {
            await server.command_uuid(uniqueId, 'ring_ready', undefined, 1_000)
            await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
            await sleep(7 * second)
            await server.hangup_uuid(uniqueId, undefined, 1_000)
            receivedCompletedCalls.add(uniqueId)
          } catch (err) {
            t.diagnostic(`------ receiving side ${inspect(err)}`)
          }
        })()
      }
    server1.on('CHANNEL_CREATE', serverHandler(server1))
    server2.on('CHANNEL_CREATE', serverHandler(server2))

    const logger = clientLogger()
    const client = new FreeSwitchClient({
      port: clientPort,
      logger,
    })
    const attempts = 500
    let runs = attempts
    let sentCalls = 0n
    let failures = 0
    t.diagnostic('---------- service ------------')
    try {
      let running = true
      while (runs-- > 0 && running) {
        await sleep(10) // 100 cps
        void (async function () {
          try {
            await client.bgapi(
              `originate sofia/test-client/sip:test@${domain} &park`,
              1000
            )
            sentCalls++
          } catch (error) {
            const err = error
            t.diagnostic(`------ stopped run ----- ${inspect(err)}`)
            running = false
          }
        })()
      }
    } catch (ex) {
      t.diagnostic(`------ sending side ${inspect(ex)}`)
      failures++
    }
    await sleep(20 * second)
    clearInterval(timer)
    client.end()
    server1.end()
    server2.end()
    t.diagnostic(
      `------ runs: ${runs} sent_calls: ${sentCalls} received_calls: ${receivedCalls.size} received_completed_calls: ${receivedCompletedCalls.size} failures: ${failures} attempts: ${attempts} ---------------`
    )
    if (receivedCompletedCalls.size === attempts && failures === 0) {
      t.diagnostic('OK')
    } else {
      throw new Error('failed')
    }
  })
})
