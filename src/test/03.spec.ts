import { after, before, describe, it } from 'node:test'

import { start, stop, clientLogger, serverLogger, DoCatch } from './utils.js'
import { inspect } from 'node:util'

import { FreeSwitchClient, FreeSwitchFailedCommandError } from '../esl-lite.js'
import { ulid } from 'ulidx'
import { second, sleep } from '../sleep.js'

const clientPort = 8024
const serverPort = 8022
const domain = '127.0.0.1:5062'

void describe('03.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  void it('03-ok', async (t) => {
    const sLogger = serverLogger()
    const server = new FreeSwitchClient({
      port: serverPort,
      logger: sLogger,
    })
    server.once('CHANNEL_CREATE', (call) => {
      const direction = call.body.data['Call-Direction']
      if (direction !== 'inbound') {
        return
      }
      const uniqueId = call.body.uniqueID
      if (uniqueId == null) {
        sLogger.error(call, 'No uniqueId')
        return
      }
      DoCatch(t, async () => {
        t.diagnostic('server: call command answer')
        await server.command_uuid(uniqueId, 'answer', undefined, 1_000)
        await sleep(10_000)
        t.diagnostic('server: call command hangup')
        await server.command_uuid(uniqueId, 'hangup', undefined, 1_000)
        t.diagnostic('server: call end')
      })
    })

    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(),
    })
    t.diagnostic('client: service bgapi originate')
    const uuid = ulid()
    const res = await client.bgapi(
      `originate {origination_uuid=${uuid}}sofia/test-client/sip:server7002@${domain} &park`,
      2000
    )
    t.diagnostic('bgapi response: ' + inspect(res))
    let outcome = undefined
    if (res instanceof Error) {
      outcome = new Error(res.message)
    } else {
      t.diagnostic('client: service hangup')
      const res2 = await client.hangup_uuid(uuid, undefined, 1_000)
      if (res2 instanceof FreeSwitchFailedCommandError) {
        outcome = new Error(res2.response)
      } else if (res2 instanceof Error) {
        outcome = new Error(res2.message)
      }
    }
    t.diagnostic('client: end')
    client.end()
    server.end()
    if (outcome instanceof Error) {
      throw outcome
    }
  })
})
