import { after, before, describe, it } from 'node:test'

import { FreeSwitchClient, once } from '../esl-lite.js'

import { clientLogger, start, stop, onceConnected } from './utils.js'
import { second, sleep } from './tools.js'
import assert from 'node:assert'
import { inspect } from 'node:util'

// We start two FreeSwitch docker.io instances, one is used as the "client" (and is basically our SIP test runner), while the other one is the "server" (and is used to test the `server` side of the package).
const clientPort = 8024

describe('10-client-image.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  it(
    '10-client-image: should be reachable',
    { timeout: 4 * second },
    async () => {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const p = once(client, 'connect')
      client.connect()
      await p
      client.end()
    }
  )

  it(
    '10-client-image: should report @once errors',
    { timeout: 4 * second },
    async function () {
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
    }
  )

  it(
    '10-client-image: should properly parse JSON events (no subclass)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (no subclass): create client'
      )
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.once('reconnecting', () => {
        client.end()
      })

      const q = client.onceAsync('connect')
      client.connect()
      t.diagnostic('waiting for connection')
      const [call] = await q
      const msgP = call.onceAsync('CUSTOM')
      await call.sendevent('CUSTOM', {
        'Event-XBar': 'ë°ñA',
      })
      t.diagnostic('waiting for CUSTOM event')
      const [msg] = await msgP
      t.diagnostic('closing')
      client.end()
      assert(
        'Event-Name' in msg.body.data &&
          msg.body.data['Event-Name'] === 'CUSTOM' &&
          'Event-XBar' in msg.body.data &&
          msg.body.data['Event-XBar'] === 'ë°ñA'
      )
    }
  )

  it(
    '10-client-image: should properly parse JSON events (subclass, no filtering)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (subclass, no filtering): create client'
      )
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.once('reconnecting', () => {
        client.end()
      })

      const q = client.onceAsync('connect')
      client.connect()
      t.diagnostic('waiting for connection')
      const [call] = await q

      let received = 0
      call.on('CUSTOM', (msg) => {
        received++
        assert(
          'Event-Name' in msg.body.data &&
            msg.body.data['Event-Name'] === 'CUSTOM' &&
            'Event-XBar' in msg.body.data &&
            msg.body.data['Event-YBar'] === 'ë°ñ'
        )
      })

      await call.sendevent('CUSTOM', {
        'Event-Subclass': 'json::precious',
        'Event-YBar': 'ë°ñ',
      })
      t.diagnostic('waiting for CUSTOM event')
      await sleep(1000)
      t.diagnostic('closing')
      client.end()
      /* This one is expected to fail. */
      if (received > 0) {
        throw new Error(`recevied ${received}`)
      }
    }
  )

  it(
    '10-client-image: should properly parse JSON events (subclass, take 1)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (subclass, take 1): create client'
      )
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.once('reconnecting', () => {
        client.end()
      })

      const q = client.onceAsync('connect')
      client.connect()
      t.diagnostic('waiting for connection')
      const [call] = await q
      await call.send('event json CUSTOM json::precious ', {}, 100)
      const msgP = call.onceAsync('CUSTOM')
      await call.sendevent('CUSTOM', {
        'Event-Subclass': 'json::precious',
        'Event-XBar': 'ë°ñ1',
      })
      t.diagnostic('waiting for CUSTOM event')
      const [msg] = await msgP
      t.diagnostic('closing')
      client.end()
      assert(
        'Event-Name' in msg.body.data &&
          msg.body.data['Event-Name'] === 'CUSTOM' &&
          'Event-XBar' in msg.body.data &&
          msg.body.data['Event-XBar'] === 'ë°ñ1'
      )
    }
  )

  it(
    '10-client-image: should properly parse JSON events (subclass, take 2)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (subclass, take 2): create client'
      )
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.once('reconnecting', () => {
        client.end()
      })

      const q = client.onceAsync('connect')
      client.connect()
      t.diagnostic('waiting for connection')
      const [call] = await q
      const msgP = call.custom.onceAsync('json::precious2')
      await call.sendeventCUSTOM('json::precious2', {
        'Event-YBar': 'ë°ñ2',
      })
      t.diagnostic('waiting for CUSTOM event')
      const [msg] = await msgP
      t.diagnostic('closing')
      client.end()
      assert(
        'Event-Name' in msg.body.data &&
          msg.body.data['Event-Name'] === 'CUSTOM' &&
          'Event-YBar' in msg.body.data &&
          msg.body.data['Event-YBar'] === 'ë°ñ2',
        inspect(msg.body.data)
      )
    }
  )

  it(
    '10-client-image: should properly parse JSON events (subclass, take 3)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (subclass, take 3): create client'
      )
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.once('reconnecting', () => {
        client.end()
      })

      const q = client.onceAsync('connect')
      client.connect()
      t.diagnostic('waiting for connection')
      const [call] = await q
      const msgP = call.custom.onceAsync('conference::maintenance')
      await call.sendeventCUSTOM('conference::maintenance', {
        'Event-ZBar': 'ë°ñ3',
      })
      t.diagnostic('waiting for CUSTOM event')
      const [msg] = await msgP
      t.diagnostic('closing')
      client.end()
      assert(
        'Event-Name' in msg.body.data &&
          msg.body.data['Event-Name'] === 'CUSTOM' &&
          'Event-Subclass' in msg.body.data &&
          msg.body.data['Event-Subclass'] === 'conference::maintenance' &&
          'Event-ZBar' in msg.body.data &&
          msg.body.data['Event-ZBar'] === 'ë°ñ3',
        inspect(msg.body.data)
      )
    }
  )

  it(
    '10-client-image: should reloadxml',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic('Should reloadxml: create client')
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const cmd = 'reloadxml'
      const p = client.onceAsync('connect').then(async ([call]) => {
        t.diagnostic('connected')
        await call.bgapi(cmd, 1000)
      })
      client.connect()
      t.diagnostic('waiting for connection')
      await p
      t.diagnostic('closing')
      client.end()
      return
    }
  )
})
