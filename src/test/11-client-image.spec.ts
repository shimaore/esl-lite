import { after, before, describe, it } from 'node:test'

import {
  FreeSwitchClient,
  once,
} from '../esl-lite.js'

import { clientLogger, start, stop } from './utils.js'
import { second, sleep } from './tools.js'
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

it( '10-client-image: should properly parse plain events', async (t) => {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(),
  })

  const p = (async () => {
    const [call] = await client.onceAsync('connect')
    const res = await call.send('event plain ALL', {}, 1000)
    if (res instanceof Error) {
      throw res
    }
    assert.match(
      res.headers.replyText ?? '',
      /\+OK event listener enabled plain/
    )
    const msgP = once(call.custom, 'plain::precious')
    await call.sendeventCUSTOM('plain::precious', {
      'Event-XBar': 'some',
    })
    const [msg] = await msgP
    if ('Event-Name' in msg.body.data && msg.body.data['Event-Name'] === 'CUSTOM' &&
        'Event-Subclass' in msg.body.data && msg.body.data['Event-Subclass'] === 'plain::precious' &&
        'Event-XBar' in msg.body.data && msg.body.data['Event-XBar'] === 'some') {
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
})
