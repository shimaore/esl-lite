import { after, before, describe, it } from 'node:test'

import { FreeSwitchClient, ValueMap } from '../esl-lite.js'

import { clientLogger, start, stop } from './utils.js'
import assert from 'node:assert'
import { inspect } from 'node:util'
import { second, sleep } from '../sleep.js'

// We start two FreeSwitch docker.io instances, one is used as the "client" (and is basically our SIP test runner), while the other one is the "server" (and is used to test the `server` side of the package).
const clientPort = 8024

class PublicFreeSwitchClient extends FreeSwitchClient {
  async sendPublic(command: string, headers: ValueMap, timeout: number) {
    return await this.send(command, headers, timeout)
  }
}

void describe('10-client-image.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  void it(
    '10-client-image: should be reachable',
    { timeout: 4 * second },
    async () => {
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      client.end()
    }
  )

  void it(
    '10-client-image: should report @once errors',
    { timeout: 4 * second },
    async function () {
      const client = new PublicFreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const failure = await client.sendPublic('catchme', {}, 100).then(
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

  void it(
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

      const msgP = client.onceAsync('CUSTOM')
      await client.sendevent(
        'CUSTOM',
        {
          'Event-XBar': 'ë°ñA',
        },
        1_000
      )
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

  void it(
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

      let received = 0
      client.on('CUSTOM', (msg) => {
        assert(
          'Event-Name' in msg.body.data &&
            msg.body.data['Event-Name'] === 'CUSTOM' &&
            'Event-XBar' in msg.body.data &&
            msg.body.data['Event-YBar'] === 'ë°ñ'
        )
        received++
      })

      await client.sendevent(
        'CUSTOM',
        {
          'Event-Subclass': 'json::precious',
          'Event-YBar': 'ë°ñ',
        },
        1_000
      )
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

  void it(
    '10-client-image: should properly parse JSON events (subclass, take 1)',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic(
        'Should properly parse JSON events (subclass, take 1): create client'
      )
      const client = new PublicFreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })

      await client.sendPublic('event json CUSTOM json::precious ', {}, 100)
      const msgP = client.onceAsync('CUSTOM')
      await client.sendevent(
        'CUSTOM',
        {
          'Event-Subclass': 'json::precious',
          'Event-XBar': 'ë°ñ1',
        },
        1_000
      )
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

  void it(
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

      const msgP = client.custom.onceAsync('json::precious2')
      await client.sendevent(
        'CUSTOM',
        {
          'Event-Subclass': 'json::precious2',
          'Event-YBar': 'ë°ñ2',
        },
        1_000
      )
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

  void it(
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

      const msgP = client.custom.onceAsync('conference::maintenance')
      await client.sendevent(
        'CUSTOM',
        {
          'Event-Subclass': 'conference::maintenance',
          'Event-ZBar': 'ë°ñ3',
        },
        1_000
      )
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

  void it(
    '10-client-image: should reloadxml',
    { timeout: 4 * second },
    async (t) => {
      t.diagnostic('Should reloadxml: create client')
      const client = new FreeSwitchClient({
        port: clientPort,
        logger: clientLogger(),
      })
      const cmd = 'reloadxml'
      await client.bgapi(cmd, 1000)
      t.diagnostic('closing')
      client.end()
      return
    }
  )
})
