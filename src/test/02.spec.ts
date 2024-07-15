import test from 'node:test'

import { clientLogger, onceConnected, start, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'

const clientPort = 8024

test.before(start)
test.after(stop)

test('02-ok', async () => {
  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(),
  })
  const p = onceConnected(client)
  client.connect()
  await p
  client.end()
})
