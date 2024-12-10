import { after, before, describe, it } from 'node:test'

import { start, stop, clientLogger as logger, serverLogger } from './utils.js'

import { v4 as uuidv4 } from 'uuid'

import { timer, optionsText } from './tools.js'
import { FreeSwitchClient } from '../esl-lite.js'
import assert from 'node:assert'
import { inspect } from 'node:util'
import { second, sleep } from '../sleep.js'

const domain = '127.0.0.1:5062'

// Client and server interaction
// -----------------------------

// These tests are long-runners.
const serverPort = 8022
const sLogger = serverLogger()
const server = new FreeSwitchClient({
  logger: sLogger,
  port: serverPort,
})

const cps = 2

const clientPort = 8024

void describe('15-base-client.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  let sCount = 0
  before(
    () => {
      server.on('CHANNEL_CREATE', (call) => {
        const uniqueId = call.body.uniqueID
        if (uniqueId == null) {
          sLogger.error(call, 'No uniqueID')
          return
        }
        sCount++
        ;(async (): Promise<void> => {
          const destination = call.body.data['variable_sip_req_user']
          console.info('received call', destination)
          switch (destination) {
            case 'answer-wait-15000':
              await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
              await sleep(15 * second)
              await server.command_uuid(
                uniqueId,
                'hangup',
                '200 answer-wait-15000',
                1_000
              )
              break
            case 'wait-15000-answer':
              await sleep(15 * second)
              await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
              await sleep(1 * second)
              await server.command_uuid(
                uniqueId,
                'hangup',
                '200 answer-wait-15000',
                1_000
              )
              break
            case 'answer-wait-3000':
              await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
              await sleep(3 * second)
              await server
                .command_uuid(uniqueId, 'hangup', '200 answer-wait-3000', 1_000)
                .catch(() => true)
              break
            default:
              console.error({ destination }, 'Invalid destination')
          }
          sCount--
        })().catch((err: unknown) => {
          sLogger.error({ err }, 'Server-side error')
        })
      })
    },
    { timeout: 12 * second }
  )

  after(
    async () => {
      await sleep(8 * second)
      server.end()
      if (sCount > 0) {
        throw new Error(`Oops, ${sCount} active connections leftover`)
      }
    },
    { timeout: 10 * second }
  )

  void it(
    '15-base-client: should detect leg_progress_timeout',
    { timeout: 4 * second },
    async function () {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_progress_timeout: 1,
        tracer_uuid: id,
      }
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:wait-15000-answer@${domain} &park`,
        15000
      )
      client.end()
      if (res instanceof Error) {
        throw res
      } else {
        assert.strictEqual(res.body.response, '-ERR PROGRESS_TIMEOUT\n')
      }
    }
  )

  void it(
    '15-base-client: should detect leg_timeout',
    { timeout: 4 * second },
    async function () {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_timeout: 2,
        tracer_uuid: id,
      }
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:wait-15000-answer@${domain} &park`,
        15000
      )
      client.end()
      if (res instanceof Error) {
        throw res
      } else {
        assert.strictEqual(res.body.response, '-ERR ALLOTTED_TIMEOUT\n')
      }
    }
  )

  void it(
    '15-base-client: should detect hangup',
    { timeout: 18 * second },
    async (t) => {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        tracer_uuid: id,
      }
      const duration = timer()
      let success = 0
      client.on('CHANNEL_HANGUP', function (msg) {
        t.diagnostic(`msg = ${inspect(msg)}`)
        if (msg.body.data['variable_tracer_uuid'] === id) {
          const d = duration()
          assert(d > 14 * second)
          assert(d < 16 * second)
          success++
        }
      })
      await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:answer-wait-15000@${domain} &park`,
        16_000
      )
      await sleep(16 * second)
      client.end()
      if (success !== 1) {
        throw new Error(`Failed, success=${success}`)
      }
    }
  )

  // This is a simple test to make sure the client can work with both legs.
  const count = 40
  void it(
    '15-base-client: should work with simple routing',
    { timeout: (4000 * count) / cps },
    async function (t) {
      let sent = 0
      let caughtClient = 0
      let outcome = undefined
      const newCall = function (): void {
        const client = new FreeSwitchClient({
          port: clientPort,
          logger: logger(),
        })
        void (async function () {
          try {
            await client.bgapi(
              `originate sofia/test-client/sip:answer-wait-3000@${domain} &bridge(sofia/test-client/sip:answer-wait-3000@${domain})`,
              4000
            )
            sent += 2
            await sleep(4000)
            client.end()
          } catch (error) {
            outcome = 'failed'
            caughtClient++
            t.diagnostic(
              `Caught ${caughtClient} client errors: ${inspect(error)}`
            )
          }
        })()
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
    }
  )
})
