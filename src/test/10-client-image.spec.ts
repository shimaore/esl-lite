import { after, before, describe, it } from 'node:test'

import {
  FreeSwitchClient,
  once,
} from '../esl-lite.js'

import { clientLogger, start, stop, onceConnected } from './utils.js'
import { second, sleep } from './tools.js'
import { inspect } from 'node:util'
import assert from 'node:assert'

// We start two FreeSwitch docker.io instances, one is used as the "client" (and is basically our SIP test runner), while the other one is the "server" (and is used to test the `server` side of the package).
const clientPort = 8024

describe('10-client-image.spec', () => {
before(start, { timeout: 12*second })
after(stop, { timeout: 12*second })

it('10-client-image: should be reachable', async () => {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(),
  })
  const p = once(client, 'connect')
  client.connect()
  await p
  client.end()
})

it('10-client-image: should report @once errors', async function () {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(),
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
  if (failure == null) {
    throw new Error('should have failed')
  }
})

it( '10-client-image: should properly parse JSON events', async (t) => {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(),
  })
  const p = (async () => {
    const [call] = await client.onceAsync('connect')
    const res = await call.send('event json ALL', {}, 1000)
    if (res instanceof Error) {
      throw res
    }
    assert.match(
      res.headers.replyText ?? '',
      /\+OK event listener enabled json/
    )
    const msgP = once(call.custom, 'json::precious')
    await call.sendeventCUSTOM('json::precious', {
      'Event-XBar': 'ë°ñ',
    })
    const [msg] = await msgP
    if ('Event-Name' in msg.body.data && msg.body.data['Event-Name'] === 'CUSTOM' &&
        'Event-Subclass' in msg.body.data && msg.body.data['Event-Subclass'] === 'json::precious' &&
        'Event-XBar' in msg.body.data && msg.body.data['Event-XBar'] === 'ë°ñ') {
      call.end('Test completed')
      t.diagnostic('Test OK')
    } else {
      t.diagnostic('Test failed, invalid content')
      throw new Error('invalid content')
    }
  })()
  client.connect()
  t.diagnostic('sleep 500')
  await sleep(500)
  t.diagnostic('client.end()')
  client.end()
  t.diagnostic('await p')
  return await p
})

it('10-client-image: should reloadxml', async function (t) {
  return new Promise( (resolve,reject) => {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(),
    })
    const cmd = 'reloadxml'
    client.on('connect', function (call): void {
      void (async function () {
        try {
          const res = await call.bgapi(cmd, 1000)
            t.diagnostic(inspect(res))
            resolve()
        } catch (ex) {
            t.diagnostic(inspect(ex))
            reject(ex)
        } finally {
            client.end()
        }
      })()
    })
    client.connect()
  })
})

})
