import test from 'node:test'

import { clientLogger, onceConnected, startServer, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { second } from './tools.js'
import { inspect } from 'node:util'

const serverPort = 8022

test.before(async () => {
  await startServer()
}, { timeout: 12*second })
test.after(stop, { timeout: 12*second })

test('10-server-image: should be reachable', async () => {
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(),
  })
  const p = onceConnected(client)
  client.connect()
  await p
  client.end()
})

test('10-server-image: should reloadxml', async function (t) {
  const cmd = 'reloadxml'
  const client = new FreeSwitchClient({
    port: serverPort,
    logger: clientLogger(),
  })
  const p = onceConnected(client)
  client.connect()
  const call = await p
  const res = await call.bgapi(cmd, 300)
  t.diagnostic(inspect(res))
  let outcome = undefined
  if (res instanceof Error) {
    outcome = new Error(res.message)
  } else {
    if (typeof res.body.response === 'string') {
      outcome = res.body.response.match(/\+OK \[Success\]/)
    }
  }
  client.end()
  if (outcome instanceof Error) {
    throw outcome
  }
  if (outcome == null) {
    throw new Error('Invalid response')
  }
})
