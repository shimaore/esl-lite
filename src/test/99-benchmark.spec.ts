import { after, before, describe, it } from 'node:test'

import { FreeSwitchClient } from '../esl-lite.js'

import * as legacyESL from 'esl'

import { clientLogger, start, stop } from './utils.js'
import { second, sleep } from './tools.js'
import { inspect } from 'node:util'

const clientPort = 8024

const dialplanPort = 7000

const domain = '127.0.0.1:5062'

void describe('99-benchmark.spec', () => {
before(start, { timeout: 12*second })
after(async function () {
  // Ava runs tests in parallel, so let's wait long enough for the other tests to
  // complete!
  await sleep(30 * second)
  await stop()
}, { timeout: 50 * second })

void it('should be reachable', { timeout: 35 * second }, async function (t) {
  const logger = clientLogger()
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
      t.diagnostic(inspect({
        server: server.stats,
        server2: server2.stats,
        connection_count: await server.getConnectionCount(),
        max_connections: server.getMaxConnections(),
        runs,
        sentCalls,
        receivedCalls,
        receivedCompletedCalls,
      }))
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
        t.diagnostic(`------ receiving side ${err}`)
      }
    })()
  }
  server.on('connection', serverHandler)
  server2.on('connection', serverHandler)
  const attempts = 500n
  let runs = attempts
  let sentCalls = 0n
  let failures = 0
  client.on('connect', function (service): void {
    void (async function () {
      t.diagnostic('---------- service ------------')
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
              t.diagnostic(`------ stopped run ----- ${err}`)
              running = false
            }
          })()
        }
      } catch (ex) {
        t.diagnostic(`${ex}`)
        failures++
      }
    })()
  })
  client.connect()
  await sleep(20 * second)
  clearInterval(timer)
  client.end()
  await server.close()
  await server2.close()
  t.diagnostic(
    `------ runs: ${runs} sent_calls: ${sentCalls} received_calls: ${receivedCalls} received_completed_calls: ${receivedCompletedCalls} ---------------`
  )
  if (receivedCompletedCalls === attempts && failures === 0) {
    true
  } else {
    throw new Error('failed')
  }
})

})
