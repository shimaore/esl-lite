import { TestContext, after, before, describe, it } from 'node:test'

import { FreeSwitchClient } from '../esl-lite.js'

import { clientLogger as logger, start, stop } from './utils.js'

import { v4 as uuidv4 } from 'uuid'

import { timer, optionsText } from './tools.js'
import * as legacyESL from 'esl'
import { inspect } from 'node:util'
import assert from 'node:assert'
import { second, sleep } from '../sleep.js'

const clientPort = 8024

const domain = '127.0.0.1:5062'

void describe('80-error.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  // `leg_progress_timeout` counts from the time the INVITE is placed until a progress indication (e.g. 180, 183) is received. Controls Post-Dial-Delay on assert.strictEqual leg.

  // `leg_timeout` restricts the length of ringback, à la `bridge_answer_timeout`

  // This flag is used to hide extraneous messages (esp. benchmark data) during regular tests.

  // Test for error conditions
  // =========================

  // The goal is to document how to detect error conditions, especially wrt LCR conditions.
  let server: legacyESL.FreeSwitchServer | null = null

  before(async function () {
    const service = function (
      call: legacyESL.FreeSwitchResponse,
      { data }: { data: legacyESL.StringMap }
    ): void {
      const destination = data['variable_sip_req_user']
      const m = destination?.match(/^wait-(\d+)-respond-(\d+)$/)
      ;(async () => {
        switch (false) {
          case destination !== 'answer-wait-3010':
            try {
              await call.command('answer')
              await sleep(3010)
            } catch (e) {
              console.warn('(ignored)', e)
            }
            break
          case destination !== 'wait-24000-ring-ready':
            await sleep(24000)
            await call.command('ring_ready').catch(function () {
              return true
            })
            await sleep(9999)
            break
          case m == null:
            if (
              m != null &&
              typeof m[1] === 'string' &&
              typeof m[2] === 'string'
            ) {
              await sleep(parseInt(m[1]))
              try {
                await call.command('respond', m[2])
                await sleep(9999)
              } catch (e: unknown) {
                console.warn(`${(e as Error).toString()} (ignored)`)
              }
            }
            break
          case destination !== 'foobared':
            try {
              await call.command('respond', '485')
            } catch (e: unknown) {
              console.warn(`${(e as Error).toString()} (ignored)`)
            }
            break
          default:
            try {
              await call.command('respond', '400')
            } catch (e: unknown) {
              console.warn(`${(e as Error).toString()} (ignored)`)
            }
        }
        call.end()
      })().catch(console.error)
    }

    server = new legacyESL.FreeSwitchServer({
      all_events: false,
      logger: logger(),
    })
    server.on('connection', service)
    await server.listen({ port: 7000 })
  })

  after(
    async function () {
      await sleep(30 * second)
      const count = await server?.getConnectionCount()
      assert.strictEqual(count, 0, `Oops, ${count} active connections leftover`)
      await server?.close()
      return null
    },
    { timeout: 42 * second }
  )

  void it('should handle `sofia status`', async function (t) {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(),
    })
    const res = await client.bgapi('sofia status', 1000)
    t.diagnostic(inspect(res))
    client.end()
  })

  void it('should detect invalid syntax', async function (t) {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(),
    })
    const res = await client.bgapi('originate foobar', 1000)
    t.diagnostic(`${inspect(res)} response`)
    let outcome = undefined
    if (res instanceof Error) {
      outcome = res
    } else {
      const { response } = res.body
      if (typeof response === 'string') {
        assert.match(response, /^-USAGE/)
      } else {
        t.diagnostic(inspect(response))
        outcome = response
      }
    }
    client.end()
    if (outcome != null) {
      if (outcome instanceof Error) {
        throw outcome
      } else {
        throw new Error(inspect(outcome))
      }
    }
  })

  void it(
    'should process normal call',
    { timeout: 5 * second },
    async function (t) {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const res = await client.bgapi(
        `originate sofia/test-client/sip:answer-wait-3010@${domain} &park`,
        4000
      )
      t.diagnostic(`API was successful ${inspect(res)}`)
      client.end()
    }
  )

  void it(
    'should detect invalid (late) syntax',
    { timeout: 5 * second },
    async function (t) {
      const id = uuidv4()
      const options = {
        tracer_uuid: id,
      }
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const p = client.onceAsync('CHANNEL_EXECUTE_COMPLETE').then(([res]) => {
        assert.strictEqual(
          res.body.data['variable_tracer_uuid'],
          id,
          'Missing tracer_uuid'
        )
        assert.strictEqual(
          res.body.data['variable_originate_disposition'],
          'CHAN_NOT_IMPLEMENTED'
        )
      })
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:answer-wait-3010@${domain} &bridge(foobar)`,
        1000
      )
      if (res instanceof Error) {
        client.end()
        throw res
      }
      t.diagnostic(`bgapi returned ${inspect(res)}`)
      await p
      client.end()
    }
  )

  void it(
    'should detect missing host',
    { timeout: 4 * second },
    async function (t) {
      // It shouldn't take us more than 4 seconds (given the value of timer-T2 set to 2000).
      // The client attempt to connect an non-existent IP address on a valid subnet ("host down").
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_progress_timeout: 8,
        leg_timeout: 16,
        tracer_uuid: id,
      }
      const duration = timer()
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client-open/sip:test@172.17.0.46:9999 &park`,
        3000
      )
      t.diagnostic(`API was successful ${inspect(res)}`)
      if (res instanceof Error) {
        throw res
      } else {
        const { response } = res.body
        if (typeof response === 'string') {
          assert.match(response, /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
          const d = duration()
          assert(d > 1 * second, `Duration is too short (${d}ms)`)
          assert(d < 3 * second, `Duration is too long (${d}ms)`)
        } else {
          console.info(response)
          throw new Error('response is not a string')
        }
      }
      client.end()
    }
  )

  void it('should detect closed port', { timeout: 2200 }, async function (t) {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(),
    })
    const id = uuidv4()
    const options = {
      leg_progress_timeout: 8,
      leg_timeout: 16,
      tracer_uuid: id,
    }
    const duration = timer()
    const res = await client.bgapi(
      `originate [${optionsText(options)}]sofia/test-client/sip:test@127.0.0.1:1310 &park`,
      2000
    )
    t.diagnostic(`API was successful ${inspect(res)}`)

    if (res instanceof Error) {
      throw res
    } else {
      const { response } = res.body
      if (typeof response === 'string') {
        assert.match(response, /^-ERR NORMAL_TEMPORARY_FAILURE/)
        const d = duration()
        assert(d < 4 * second, `Duration is too long (${d}ms)`)
      } else {
        console.info(response)
        throw new Error('response is not a string')
      }
    }
    client.end()
  })

  void it(
    'should detect invalid destination',
    { timeout: 2200 },
    async function (t) {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_progress_timeout: 8,
        leg_timeout: 16,
        tracer_uuid: id,
      }
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:foobared@${domain} &park`,
        1000
      )
      t.diagnostic(`API was successful ${inspect(res)}`)
      if (res instanceof Error) {
        throw res
      } else {
        const { response } = res.body
        if (typeof response === 'string') {
          assert.match(response, /^-ERR NO_ROUTE_DESTINATION/)
        } else {
          console.info(response)
          throw new Error('response is not a string')
        }
      }
      client.end()
    }
  )

  void it(
    'should detect late progress',
    { timeout: 10000 },
    async function (t) {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_progress_timeout: 8,
        leg_timeout: 16,
        tracer_uuid: id,
      }
      const duration = timer()
      const res = await client.bgapi(
        `originate [${optionsText(options)}]sofia/test-client/sip:wait-24000-ring-ready@${domain} &park`,
        9000
      )
      t.diagnostic(`API was successful ${inspect(res)}`)
      if (res instanceof Error) {
        throw res
      } else {
        const { response } = res.body
        if (typeof response === 'string') {
          assert.match(response, /^-ERR PROGRESS_TIMEOUT/)
          assert(duration() > (options.leg_progress_timeout - 1) * second)
          assert(duration() < (options.leg_progress_timeout + 1) * second)
        } else {
          console.info(response)
          throw new Error('response is not a string')
        }
      }
      client.end()
    }
  )

  // SIP Error detection
  // ===================
  const shouldDetect = function (code: string, pattern: RegExp) {
    return async function (t: TestContext) {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: logger(),
      })
      const id = uuidv4()
      const options = {
        leg_timeout: 2,
        leg_progress_timeout: 16,
        tracer_uuid: id,
      }
      t.diagnostic('preparing')
      client.on('CHANNEL_CREATE', function (msg) {
        assert(
          'variable_tracer_uuid' in msg.body.data &&
            msg.body.data['variable_tracer_uuid'] === id
        )
      })
      client.on('CHANNEL_ORIGINATE', function (msg) {
        assert(
          'variable_tracer_uuid' in msg.body.data &&
            msg.body.data['variable_tracer_uuid'] === id
        )
      })
      client.once('CHANNEL_HANGUP', function (msg) {
        assert(
          'variable_tracer_uuid' in msg.body.data &&
            msg.body.data['variable_tracer_uuid'] === id &&
            'variable_sip_term_status' in msg.body.data &&
            msg.body.data['variable_sip_term_status'] === code
        )
      })
      client.on('CHANNEL_HANGUP_COMPLETE', function (msg) {
        assert(
          'variable_tracer_uuid' in msg.body.data &&
            msg.body.data['variable_tracer_uuid'] === id &&
            'variable_sip_term_status' in msg.body.data &&
            msg.body.data['variable_sip_term_status'] === code &&
            'variable_billmsec' in msg.body.data &&
            msg.body.data['variable_billmsec'] === '0'
        )
      })
      t.diagnostic(`sending call for ${code}`)
      const res = await client.bgapi(
        `originate {${optionsText(options)}}sofia/test-client/sip:wait-100-respond-${code}@${domain} &park`,
        500
      )
      t.diagnostic(`bgapi returned for ${code}: ${inspect(res)}`)
      let outcome = undefined
      if (res instanceof Error) {
        outcome = res
      } else {
        assert.strictEqual(typeof res.body.response, 'string')
        if (typeof res.body.response === 'string') {
          assert.match(res.body.response, pattern)
        }
      }
      await sleep(50)
      client.end()
      if (outcome != null) {
        throw outcome
      }
    }
  }

  // Anything below 4xx isn't an error
  void it(
    'should detect 403',
    { timeout: 1000 },
    shouldDetect('403', /^-ERR CALL_REJECTED/)
  )
  void it(
    'should detect 404',
    { timeout: 1000 },
    shouldDetect('404', /^-ERR UNALLOCATED_NUMBER/)
  )

  // test 'should detect 407', should_detect '407', ... res has variable_sip_hangup_disposition: 'send_cancel' but no variable_sip_term_status
  void it(
    'should detect 408',
    { timeout: 1000 },
    shouldDetect('408', /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
  )
  void it(
    'should detect 410',
    { timeout: 1000 },
    shouldDetect('410', /^-ERR NUMBER_CHANGED/)
  )
  void it(
    'should detect 415',
    { timeout: 1000 },
    shouldDetect('415', /^-ERR SERVICE_NOT_IMPLEMENTED/)
  )
  void it(
    'should detect 450',
    { timeout: 1000 },
    shouldDetect('450', /^-ERR NORMAL_UNSPECIFIED/)
  )
  void it(
    'should detect 455',
    { timeout: 1000 },
    shouldDetect('455', /^-ERR NORMAL_UNSPECIFIED/)
  )
  void it(
    'should detect 480',
    { timeout: 1000 },
    shouldDetect('480', /^-ERR NO_USER_RESPONSE/)
  )
  void it(
    'should detect 481',
    { timeout: 1000 },
    shouldDetect('481', /^-ERR NORMAL_TEMPORARY_FAILURE/)
  )
  void it(
    'should detect 484',
    { timeout: 1000 },
    shouldDetect('484', /^-ERR INVALID_NUMBER_FORMAT/)
  )
  void it(
    'should detect 485',
    { timeout: 1000 },
    shouldDetect('485', /^-ERR NO_ROUTE_DESTINATION/)
  )
  void it(
    'should detect 486',
    { timeout: 1000 },
    shouldDetect('486', /^-ERR USER_BUSY/)
  )
  void it(
    'should detect 487',
    { timeout: 1000 },
    shouldDetect('487', /^-ERR ORIGINATOR_CANCEL/)
  )
  void it(
    'should detect 488',
    { timeout: 1000 },
    shouldDetect('488', /^-ERR INCOMPATIBLE_DESTINATION/)
  )
  void it(
    'should detect 491',
    { timeout: 1000 },
    shouldDetect('491', /^-ERR NORMAL_UNSPECIFIED/)
  )
  void it(
    'should detect 500',
    { timeout: 1000 },
    shouldDetect('500', /^-ERR NORMAL_TEMPORARY_FAILURE/)
  )
  void it(
    'should detect 502',
    { timeout: 1000 },
    shouldDetect('502', /^-ERR NETWORK_OUT_OF_ORDER/)
  )
  void it(
    'should detect 503',
    { timeout: 1000 },
    shouldDetect('503', /^-ERR NORMAL_TEMPORARY_FAILURE/)
  )
  void it(
    'should detect 504',
    { timeout: 1000 },
    shouldDetect('504', /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
  )
  void it(
    'should detect 600',
    { timeout: 1000 },
    shouldDetect('600', /^-ERR USER_BUSY/)
  )
  void it(
    'should detect 603',
    { timeout: 1000 },
    shouldDetect('603', /^-ERR CALL_REJECTED/)
  )
  void it(
    'should detect 604',
    { timeout: 1000 },
    shouldDetect('604', /^-ERR NO_ROUTE_DESTINATION/)
  )
  void it(
    'should detect 606',
    { timeout: 1000 },
    shouldDetect('606', /^-ERR INCOMPATIBLE_DESTINATION/)
  )
})
