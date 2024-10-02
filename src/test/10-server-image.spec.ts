import { after, before, describe, it } from 'node:test'

import { clientLogger, startServer, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { inspect } from 'node:util'
import { second } from '../sleep.js'

const serverPort = 8022

void describe('10-server-image.spec', () => {
  before(
    async () => {
      await startServer()
    },
    { timeout: 12 * second }
  )
  after(stop, { timeout: 12 * second })

  void it(
    '10-server-image: should be reachable',
    { timeout: 4 * second },
    async () => {
      const client = new FreeSwitchClient({
        port: serverPort,
        logger: clientLogger(),
      })
      client.end()
    }
  )

  void it(
    '10-server-image: should reloadxml',
    { timeout: 6 * second },
    async function (t) {
      const cmd = 'reloadxml'
      const client = new FreeSwitchClient({
        port: serverPort,
        logger: clientLogger(),
      })
      const res = await client.bgapi(cmd, 300)
      t.diagnostic(inspect(res))
      let outcome = undefined
      if (res instanceof Error) {
        outcome = new Error(res.message)
      } else {
        if (typeof res.body.response === 'string') {
          outcome = /\+OK \[Success\]/.exec(res.body.response)
        }
      }
      client.end()
      if (outcome instanceof Error) {
        throw outcome
      }
      if (outcome == null) {
        throw new Error('Invalid response')
      }
    }
  )
})
