import test from 'ava'

import { FreeSwitchClient, once } from '../esl-lite.js'

import { clientLogger, start, stop, onceConnected } from './utils.js'
import { sleep } from './tools.js'

// We start two FreeSwitch docker.io instances, one is used as the "client" (and is basically our SIP test runner), while the other one is the "server" (and is used to test the `server` side of the package).
const clientPort = 8024

test.before(start)
test.after.always(stop)

test('10-client-image: should be reachable', async function (t) {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = once(client, 'connect')
  client.connect()
  await p
  client.end()
  t.pass()
})

test('10-client-image: should report @once errors', async function (t) {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const call = await p
  const failure = await call.send('catchme', {}, 100).then(
    function () {
      return false
    },
    function () {
      return true
    }
  )
  client.end()
  if (failure != null) {
    t.pass()
  } else {
    t.fail()
  }
})

/*
test 'should detect and report login errors', (t) ->
  client = new FreeSwitchClient port: client_port, password: 'barfood'
  client.on 'connect',
    t.fail new Error 'Should not reach here'
    return
  client.on 'error', (error) ->
    t.pass()
    return
  client.connect()
return
*/
test('10-client-image: should reloadxml', async function (t) {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const cmd = 'reloadxml'
  client.on('connect', function (call): void {
    void (async function () {
      try {
        const res = await call.bgapi(cmd, 1000)
        t.log(res)
        client.end()
        t.pass()
      } catch (ex) {
        t.log(ex)
        t.fail()
      }
    })()
  })
  client.connect()
  await sleep(500)
})

test(
  '10-client-image: should properly parse plain events',
  async function (t) {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(t),
    })
    client.on('connect', function (call): void {
      void (async function () {
        try {
          const res = await call.send('event plain ALL', {}, 1000)
          if (res instanceof Error) {
            t.fail(res.message)
          } else {
            t.regex(
              res.headers.replyText ?? '',
              /\+OK event listener enabled plain/
            )
            const msgP = once(call.custom, 'my::precious')
            await call.sendeventCUSTOM('my::precious', {
              'Event-XBar': 'some',
            })
            const [msg] = await msgP
            t.like(msg.body.data, {
              'Event-Name': 'CUSTOM',
              'Event-Subclass': 'my::precious',
              'Event-XBar': 'some',
            })
          }
          call.end('Test completed')
          client.end()
          t.pass()
        } catch (error1) {
          t.fail()
        }
      })()
    })
    client.connect()
    await sleep(500)
  }
)

test(
  '10-client-image: should properly parse JSON events',
  async function (t) {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(t),
    })
    client.on('connect', function (call): void {
      void (async function () {
        try {
          const res = await call.send('event json ALL', {}, 1000)
          if (res instanceof Error) {
            t.fail(res.message)
          } else {
            t.regex(
              res.headers.replyText ?? '',
              /\+OK event listener enabled json/
            )
            const msgP = once(call.custom, 'your::precious')
            await call.sendeventCUSTOM('your::precious', {
              'Event-XBar': 'ë°ñ',
            })
            const [msg] = await msgP
            t.like(msg.body.data, {
              'Event-Name': 'CUSTOM',
              'Event-Subclass': 'your::precious',
              'Event-XBar': 'ë°ñ',
            })
          }
          call.end('Test completed')
          client.end()
          t.pass()
        } catch (error1) {
          t.fail()
        }
      })()
    })
    client.connect()
    await sleep(500)
  }
)
