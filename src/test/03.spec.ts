import test from 'ava'

import {
  start,
  stop,
  clientLogger,
  serverLogger,
  DoCatch,
  onceConnected,
} from './utils.js'

import * as legacyESL from 'esl'
import { FreeSwitchClient } from '../esl-lite.js'

const clientPort = 8024
const domain = '127.0.0.1:5062'

test.before(start)
test.after.always(stop)

test('03-ok', async (t) => {
  const server = new legacyESL.FreeSwitchServer({
    all_events: false,
    logger: serverLogger(t),
  })
  server.once('connection', (call) => {
    DoCatch(t, async () => {
      t.log('server: call command answer')
      await call.command('answer')
      t.log('server: call command hangup')
      await call.command('hangup')
      t.log('server: call end')
      call.end()
    })
  })
  await server.listen({ port: 7000 })

  const client = new FreeSwitchClient({
    port: clientPort,
    logger: clientLogger(t),
  })
  const p = onceConnected(client)
  client.connect()
  const service = await p
  t.log('client: service bgapi originate')
  const res = await service.bgapi(
    `originate sofia/test-client/sip:server7002@${domain} &park`,
    1000
  )
  t.log(res)
  t.log('client: service hangup')
  try {
    await service.hangup_uuid(res.body.uniqueID ?? 'NONE')
  } catch (err) {
    t.log('client: service hangup', err)
  }
  t.log('client: end')
  client.end()
  await server.close()
  t.pass()
})
