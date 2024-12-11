import { after, before, describe, it, TestContext } from 'node:test'

import { FreeSwitchClient, FreeSwitchEventData } from '../esl-lite.js'

import { dummyLogger, start, stop } from './utils.js'
import { second, sleep } from '../sleep.js'
import { inspect } from 'node:util'
import { ulid } from 'ulidx'

const clientPort = 8024
const serverPort = 8022

const sLogger = dummyLogger()
const domain = '127.0.0.1:5062'

const showReport = true

void describe('99-benchmark.spec', async () => {
  const callDuration = 7 * second

  before(start, { timeout: 12 * second })
  after(stop, { timeout: 50 * second })

  const testOnce =
    (prefix: string, attempts: number, delay: number) =>
    async (t: TestContext) => {
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

      const report = (): void => {
        console.log(
          JSON.stringify(
            {
              server: server1.stats,
              server2: server2.stats,
              connection_count: s1Count,
              max_connections: s2Count,
              runs,
              sentCalls,
              failures,
              receivedCalls: receivedCalls.size,
              receivedCompletedCalls: receivedCompletedCalls.size,
            },
            (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)
          )
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
          if (!uniqueId.startsWith(prefix)) {
            // console.log(uniqueId,prefix,call.body.data)
            return
          }
          if (receivedCalls.has(uniqueId)) {
            return
          }
          receivedCalls.add(uniqueId)
          void (async () => {
            try {
              await server.command_uuid(
                uniqueId,
                'ring_ready',
                undefined,
                1_000
              )
              await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
              await sleep(callDuration)
              await server.hangup_uuid(uniqueId, undefined, 1_000)
              receivedCompletedCalls.add(uniqueId)
            } catch (err) {
              t.diagnostic(`------ receiving side ${inspect(err)}`)
            }
          })()
        }
      server1.on('CHANNEL_CREATE', serverHandler(server1))
      server2.on('CHANNEL_CREATE', serverHandler(server2))

      const logger = dummyLogger()
      const client = new FreeSwitchClient({
        port: clientPort,
        logger,
      })
      let runs = attempts
      let sentCalls = 0n
      let failures = 0
      t.diagnostic('---------- service ------------')
      while (runs-- > 0) {
        await sleep(delay)
        void (async function () {
          try {
            await client.bgapi(
              `originate {sip_h_Call-ID=${prefix + ulid()}}sofia/test-client/sip:test@${domain};transport=udp &park`,
              1000
            )
            sentCalls++
          } catch (error) {
            const err = error
            t.diagnostic(`------ sending side ----- ${inspect(err)}`)
            failures++
          }
        })()
      }
      await sleep((attempts / (1000 / delay) + 4) * second + callDuration)
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
    }
  await it(
    'should be reachable at 100cps',
    { timeout: 35 * second },
    testOnce('a1', 500, 10)
  )
  await it(
    'should be reachable at 200cps',
    { timeout: 35 * second },
    testOnce('a2', 500, 5)
  )
  await it(
    'should be reachable at 500cps',
    { timeout: 35 * second },
    testOnce('a5', 500, 2)
  )
  /* On my dev machine FreeSwitch runs out of CPU.
  await it(
    'should be reachable at 500cps with 1000 concurrent calls',
    { timeout: 35 * second },
    async (t) => { await Promise.all([
      testOnce('ab',1000,5)(t),
      testOnce('ac',1000,5)(t),
      testOnce('ad',1000,10)(t),
    ])}
  )
  */
})
