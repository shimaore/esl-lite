import test, { type ExecutionContext } from 'ava'

import { FreeSwitchClient, FreeSwitchError } from '../esl-lite.js'

import {
  DoCatch,
  clientLogger as logger,
  onceConnected,
  start,
  stop,
} from './utils.js'

import { v4 as uuidv4 } from 'uuid'

import { second, sleep, timer, optionsText } from './tools.js'
import * as legacyESL from 'esl'

const clientPort = 8024

const domain = '127.0.0.1:5062'

test.before(start)
test.after.always(stop)

// `leg_progress_timeout` counts from the time the INVITE is placed until a progress indication (e.g. 180, 183) is received. Controls Post-Dial-Delay on this leg.

// `leg_timeout` restricts the length of ringback, à la `bridge_answer_timeout`

// This flag is used to hide extraneous messages (esp. benchmark data) during regular tests.

// Test for error conditions
// =========================

// The goal is to document how to detect error conditions, especially wrt LCR conditions.
let server: legacyESL.FreeSwitchServer | null = null

test.before(async function (t) {
  const service = function (
    call: legacyESL.FreeSwitchResponse,
    { data }: { data: legacyESL.StringMap }
  ): void {
    const destination = data['variable_sip_req_user']
    let m: any
    DoCatch(t, async () => {
      switch (false) {
        case destination !== 'answer-wait-3010':
          try {
            await call.command('answer')
            await sleep(3010)
          } catch (e) {
            t.log('(ignored)', e)
          }
          break
        case destination !== 'wait-24000-ring-ready':
          await sleep(24000)
          await call.command('ring_ready').catch(function () {
            return true
          })
          await sleep(9999)
          break
        case (m = destination?.match(/^wait-(\d+)-respond-(\d+)$/)) == null:
          if (
            m != null &&
            typeof m[1] === 'string' &&
            typeof m[2] === 'string'
          ) {
            await sleep(parseInt(m[1]))
            try {
              await call.command('respond', m[2])
              await sleep(9999)
            } catch (e) {
              t.log('(ignored)', e)
            }
          }
          break
        case destination !== 'foobared':
          try {
            await call.command('respond', '485')
          } catch (e) {
            t.log('(ignored)', e)
          }
          break
        default:
          try {
            await call.command('respond', '400')
          } catch (e) {
            t.log('(ignored)', e)
          }
      }
      call.end()
    })
  }

  server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: logger(t),
  })
  server.on('connection', service)
  await server.listen({ port: 7000 })
  t.pass()
})

test.after(async function (t) {
  t.timeout(42 * second)
  await sleep(30 * second)
  const count = await server?.getConnectionCount()
  t.is(count, 0, `Oops, ${count} active connections leftover`)
  await server?.close()
  return null
})

test('should handle `sofia status`', async function (t) {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const res = await service.bgapi('sofia status', 1000)
  t.log(res)
  t.pass()
  client.end()
})

test('should detect invalid syntax', async function (t) {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  try {
    await service.bgapi('originate foobar', 1000)
    t.fail()
  } catch (error) {
    t.log(error)
    if (error instanceof FreeSwitchError) {
      t.regex(error.res?.headers.replyText ?? 'NONE', /^-USAGE/)
    } else {
      t.fail()
    }
  }
  client.end()
})

test('should process normal call', async function (t) {
  t.timeout(5 * second)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const res = await service.bgapi(
    `originate sofia/test-client/sip:answer-wait-3010@${domain} &park`,
    4000
  )
  t.log('API was successful', res)
  t.pass()
  client.end()
})

test('should detect invalid (late) syntax', async function (t) {
  t.timeout(5 * second)
  const id = uuidv4()
  const options = {
    tracer_uuid: id,
  }
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  service.once('CHANNEL_EXECUTE_COMPLETE', function (res) {
    t.is(res.body.data['variable_tracer_uuid'], id)
    t.is(
      res.body.data['variable_originate_disposition'],
      'CHAN_NOT_IMPLEMENTED'
    )
  })
  const res = await service.bgapi(
    `originate [${optionsText(options)}]sofia/test-client/sip:answer-wait-3010@${domain} &bridge(foobar)`,
    1000
  )
  t.log('API was successful', res)
  await sleep(4 * second)
  client.end()
})

test('should detect missing host', async function (t) {
  // It shouldn't take us more than 4 seconds (given the value of timer-T2 set to 2000).
  t.timeout(4 * second)
  // The client attempt to connect an non-existent IP address on a valid subnet ("host down").
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_progress_timeout: 8,
    leg_timeout: 16,
    tracer_uuid: id,
  }
  const duration = timer()
  try {
    const res = await service.bgapi(
      `originate [${optionsText(options)}]sofia/test-client-open/sip:test@172.17.0.46:9999 &park`,
      1000
    )
    t.log('API was successful', res)
  } catch (error) {
    t.log('API failed', error)
    if (
      typeof error === 'object' &&
      error != null &&
      'args' in error &&
      typeof error.args === 'object' &&
      error.args != null &&
      'command' in error.args &&
      'reply' in error.args &&
      typeof error.args.command === 'string' &&
      typeof error.args.reply === 'string'
    ) {
      t.regex(error.args.command, RegExp(`tracer_uuid=${id}`))
      t.regex(error.args.reply, /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
      const d = duration()
      t.true(d > 1 * second, `Duration is too short (${d}ms)`)
      t.true(d < 3 * second, `Duration is too long (${d}ms)`)
    } else {
      t.fail('Missing args and/or args.command/args.reply')
    }
  }
  client.end()
})

test('should detect closed port', async function (t) {
  t.timeout(2200)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_progress_timeout: 8,
    leg_timeout: 16,
    tracer_uuid: id,
  }
  const duration = timer()
  try {
    const res = await service.bgapi(
      `originate [${optionsText(options)}]sofia/test-client/sip:test@127.0.0.1:1310 &park`,
      1000
    )
    t.log('API was successful', res)
  } catch (error) {
    t.log('API failed', error)
    if (
      typeof error === 'object' &&
      error != null &&
      'args' in error &&
      typeof error.args === 'object' &&
      error.args != null &&
      'command' in error.args &&
      'reply' in error.args &&
      typeof error.args.command === 'string' &&
      typeof error.args.reply === 'string'
    ) {
      t.regex(error.args.command, RegExp(`tracer_uuid=${id}`))
      t.regex(error.args.reply, /^-ERR NORMAL_TEMPORARY_FAILURE/)
      const d = duration()
      t.true(d < 4 * second, `Duration is too long (${d}ms)`)
    } else {
      t.fail('Missing args and/or args.command/args.reply')
    }
  }
  client.end()
})

test('should detect invalid destination', async function (t) {
  t.timeout(2200)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_progress_timeout: 8,
    leg_timeout: 16,
    tracer_uuid: id,
  }
  try {
    await service.bgapi(
      `originate [${optionsText(options)}]sofia/test-client/sip:foobared@${domain} &park`,
      1000
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error != null &&
      'args' in error &&
      typeof error.args === 'object' &&
      error.args != null &&
      'command' in error.args &&
      'reply' in error.args &&
      typeof error.args.command === 'string' &&
      typeof error.args.reply === 'string'
    ) {
      t.regex(error.args.command, RegExp(`tracer_uuid=${id}`))
      t.regex(error.args.reply, /^-ERR NO_ROUTE_DESTINATION/)
    } else {
      t.fail('Missing args and/or args.command/args.reply')
    }
  }
  client.end()
})

test('should detect late progress', async function (t) {
  t.timeout(10000)
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: logger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  const id = uuidv4()
  const options = {
    leg_progress_timeout: 8,
    leg_timeout: 16,
    tracer_uuid: id,
  }
  const duration = timer()
  try {
    await service.bgapi(
      `originate [${optionsText(options)}]sofia/test-client/sip:wait-24000-ring-ready@${domain} &park`,
      1000
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error != null &&
      'args' in error &&
      typeof error.args === 'object' &&
      error.args != null &&
      'command' in error.args &&
      'reply' in error.args &&
      typeof error.args.command === 'string' &&
      typeof error.args.reply === 'string'
    ) {
      t.regex(error.args.reply, /^-ERR PROGRESS_TIMEOUT/)
      t.true(duration() > (options.leg_progress_timeout - 1) * second)
      t.true(duration() < (options.leg_progress_timeout + 1) * second)
    } else {
      t.fail('Missing args and/or args.command/args.reply')
    }
  }
  client.end()
})

// SIP Error detection
// ===================
const shouldDetect = function (code: string, pattern: RegExp) {
  return async function (t: ExecutionContext) {
    t.timeout(1000)
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: logger(t),
    })
    const p = onceConnected(client)
    client.connect()
    const service = await p
    const id = uuidv4()
    const options = {
      leg_timeout: 2,
      leg_progress_timeout: 16,
      tracer_uuid: id,
    }
    t.log('preparing')
    service.on('CHANNEL_CREATE', function (msg) {
      t.like(msg.body.data, {
        variable_tracer_uuid: id,
      })
    })
    service.on('CHANNEL_ORIGINATE', function (msg) {
      t.like(msg.body.data, {
        variable_tracer_uuid: id,
      })
    })
    service.once('CHANNEL_HANGUP', function (msg) {
      t.like(msg.body.data, {
        variable_tracer_uuid: id,
        variable_sip_term_status: code,
      })
    })
    service.on('CHANNEL_HANGUP_COMPLETE', function (msg) {
      t.like(msg.body.data, {
        variable_tracer_uuid: id,
        variable_sip_term_status: code,
        variable_billmsec: '0',
      })
    })
    await service.filter('variable_tracer_uuid', id)
    await service.event_json(['ALL'])
    t.log(`sending call for ${code}`)
    const res = await service.bgapi(
      `originate {${optionsText(options)}}sofia/test-client/sip:wait-100-respond-${code}@${domain} &park`,
      1000
    )
    client.end()
    t.is(typeof res.body.response, 'string')
    if (typeof res.body.response === 'string') {
      t.regex(res.body.response, pattern)
    }
  }
}

// Anything below 4xx isn't an error
test.serial('should detect 403', shouldDetect('403', /^-ERR CALL_REJECTED/))

test.serial(
  'should detect 404',
  shouldDetect('404', /^-ERR UNALLOCATED_NUMBER/)
)

// test 'should detect 407', should_detect '407', ... res has variable_sip_hangup_disposition: 'send_cancel' but no variable_sip_term_status
test.serial(
  'should detect 408',
  shouldDetect('408', /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
)

test.serial('should detect 410', shouldDetect('410', /^-ERR NUMBER_CHANGED/))

test.serial(
  'should detect 415',
  shouldDetect('415', /^-ERR SERVICE_NOT_IMPLEMENTED/)
)

test.serial(
  'should detect 450',
  shouldDetect('450', /^-ERR NORMAL_UNSPECIFIED/)
)

test.serial(
  'should detect 455',
  shouldDetect('455', /^-ERR NORMAL_UNSPECIFIED/)
)

test.serial('should detect 480', shouldDetect('480', /^-ERR NO_USER_RESPONSE/))

test.serial(
  'should detect 481',
  shouldDetect('481', /^-ERR NORMAL_TEMPORARY_FAILURE/)
)

test.serial(
  'should detect 484',
  shouldDetect('484', /^-ERR INVALID_NUMBER_FORMAT/)
)

test.serial(
  'should detect 485',
  shouldDetect('485', /^-ERR NO_ROUTE_DESTINATION/)
)

test.serial('should detect 486', shouldDetect('486', /^-ERR USER_BUSY/))

test.serial('should detect 487', shouldDetect('487', /^-ERR ORIGINATOR_CANCEL/))

test.serial(
  'should detect 488',
  shouldDetect('488', /^-ERR INCOMPATIBLE_DESTINATION/)
)

test.serial(
  'should detect 491',
  shouldDetect('491', /^-ERR NORMAL_UNSPECIFIED/)
)

test.serial(
  'should detect 500',
  shouldDetect('500', /^-ERR NORMAL_TEMPORARY_FAILURE/)
)

test.serial(
  'should detect 502',
  shouldDetect('502', /^-ERR NETWORK_OUT_OF_ORDER/)
)

test.serial(
  'should detect 503',
  shouldDetect('503', /^-ERR NORMAL_TEMPORARY_FAILURE/)
)

test.serial(
  'should detect 504',
  shouldDetect('504', /^-ERR RECOVERY_ON_TIMER_EXPIRE/)
)

test.serial('should detect 600', shouldDetect('600', /^-ERR USER_BUSY/))

test.serial('should detect 603', shouldDetect('603', /^-ERR CALL_REJECTED/))

test.serial(
  'should detect 604',
  shouldDetect('604', /^-ERR NO_ROUTE_DESTINATION/)
)

test.serial(
  'should detect 606',
  shouldDetect('606', /^-ERR INCOMPATIBLE_DESTINATION/)
)
