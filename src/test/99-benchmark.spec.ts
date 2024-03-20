import test from 'ava'

import { FreeSwitchClient } from '../esl-lite.js'

import * as legacyESL from 'esl'

import { clientLogger, start, stop } from './utils.js'
import { second, sleep } from './tools.js'

const clientPort = 8024

const dialplanPort = 7000

const domain = '127.0.0.1:5062'

test.before(start)
test.after.always(async function (t) {
  t.timeout(50 * second)
  // Ava runs tests in parallel, so let's wait long enough for the other tests to
  // complete!
  await sleep(30 * second)
  await stop(t)
})

test('should be reachable', async function (t) {
  t.timeout(35 * second)
  const logger = clientLogger(t)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger,
  })
  const server = new legacyESL.FreeSwitchServer({
    logger,
  })
  await server.listen({
    port: dialplanPort,
  })
  const server2 = new legacyESL.FreeSwitchServer({
    logger,
  })
  await server2.listen({
    port: dialplanPort + 1,
  })
  const report = function (): void {
    void (async function () {
      t.log({
        server: server.stats,
        server2: server2.stats,
        connection_count: await server.getConnectionCount(),
        max_connections: server.getMaxConnections(),
        runs,
        sentCalls,
        receivedCalls,
        receivedCompletedCalls,
      })
    })()
  }
  const timer = setInterval(report, 1000)
  let receivedCalls = 0n
  let receivedCompletedCalls = 0n
  const serverHandler = function (call: legacyESL.FreeSwitchResponse): void {
    void (async function () {
      try {
        receivedCalls++
        await call.command('ring_ready')
        await call.command('answer')
        await sleep(7 * second)
        await call.hangup()
        receivedCompletedCalls++
      } catch (err) {
        t.log('------ receiving side', err)
      }
    })()
  }
  server.on('connection', serverHandler)
  server2.on('connection', serverHandler)
  const attempts = 500n
  let runs = attempts
  let sentCalls = 0n
  client.on('connect', function (service): void {
    void (async function () {
      t.log('---------- service ------------')
      try {
        let running = true
        while (runs-- > 0 && running) {
          await sleep(10) // 100 cps
          void (async function () {
            try {
              await service.bgapi(
                `originate sofia/test-client/sip:test@${domain} &park`,
                1000
              )
              sentCalls++
            } catch (error) {
              const err = error
              t.log('------ stopped run -----', err)
              running = false
            }
          })()
        }
      } catch (ex) {
        t.log(ex)
        t.fail()
      }
    })()
  })
  client.connect()
  await sleep(20 * second)
  clearInterval(timer)
  client.end()
  await server.close()
  await server2.close()
  t.log(
    `------ runs: ${runs} sent_calls: ${sentCalls} received_calls: ${receivedCalls} received_completed_calls: ${receivedCompletedCalls} ---------------`
  )
  if (receivedCompletedCalls === attempts) {
    t.pass()
  } else {
    t.fail()
  }
})
