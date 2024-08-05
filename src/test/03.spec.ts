import { after, before, describe, it } from 'node:test'

import {
  start,
  stop,
  clientLogger,
  serverLogger,
  DoCatch,
  onceConnected,
} from './utils.js'
import { inspect } from 'node:util'

import * as legacyESL from 'esl'
import { FreeSwitchClient, FreeSwitchFailedCommandError } from '../esl-lite.js'
import { second, sleep } from './tools.js'
import { ulid } from 'ulidx'

const clientPort = 8024
const domain = '127.0.0.1:5062'

describe('03.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  it('03-ok', async (t) => {
    const server = new legacyESL.FreeSwitchServer({
      all_events: false,
      logger: serverLogger(),
    })
    server.once('connection', (call) => {
      DoCatch(t, async () => {
        t.diagnostic('server: call command answer')
        await call.command('answer')
        await sleep(10_000)
        t.diagnostic('server: call command hangup')
        await call.command('hangup')
        t.diagnostic('server: call end')
        call.end()
      })
    })
    await server.listen({ port: 7000 })

    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(),
    })
    const p = onceConnected(client)
    client.connect()
    const service = await p
    t.diagnostic('client: service bgapi originate')
    const uuid = ulid()
    const res = await service.bgapi(
      `originate {origination_uuid=${uuid}}sofia/test-client/sip:server7002@${domain} &park`,
      1000
    )
    t.diagnostic('bgapi response: ' + inspect(res))
    let outcome = undefined
    if (res instanceof Error) {
      outcome = new Error(res.message)
    } else {
      t.diagnostic('client: service hangup')
      const res2 = await service.hangup_uuid(uuid)
      if (res2 instanceof FreeSwitchFailedCommandError) {
        outcome = new Error(res2.response)
      } else if (res2 instanceof Error) {
        outcome = new Error(res2.message)
      }
    }
    t.diagnostic('client: end')
    client.end()
    await server.close()
    if (outcome instanceof Error) {
      throw outcome
    }
  })
})
