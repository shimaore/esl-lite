import { after, before, describe, it } from 'node:test'

import { clientLogger, start, stop } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { second } from '../sleep.js'

const clientPort = 8024

void describe('02.spec', () => {
  before(start, { timeout: 12 * second })
  after(stop, { timeout: 12 * second })

  void it('02-ok', async () => {
    const client = new FreeSwitchClient({
      port: clientPort,
      logger: clientLogger(),
    })
    client.end()
  })
})
