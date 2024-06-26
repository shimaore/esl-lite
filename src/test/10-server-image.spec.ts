import test from 'node:test'

import { clientLogger, onceConnected, startServer, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { second } from './tools.js'

const serverPort = 8022

test.before(async (t) => {
  await startServer(t)
}, { timeout: 12*second })
test.after(stop, { timeout: 12*second })

test('10-server-image: should be reachable', async function (t) {
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  await p
  client.end()
  t.pass()
})

test('10-server-image: should reloadxml', async function (t) {
  const cmd = 'reloadxml'
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const call = await p
  const res = await call.bgapi(cmd, 300)
  t.log(res)
  if (res instanceof Error) {
    t.fail(res.message)
  } else {
    t.is(typeof res.body.response, 'string')
    if (typeof res.body.response === 'string') {
      t.regex(res.body.response, /\+OK \[Success\]/)
    }
  }
  client.end()
  t.pass()
})
