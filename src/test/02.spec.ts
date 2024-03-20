import test from 'ava'

import { clientLogger, onceConnected, start, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'

const clientPort = 8024

test.before(start)
test.after.always(stop)

test('02-ok', async (t) => {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  await p
  client.end()
  t.pass()
})
