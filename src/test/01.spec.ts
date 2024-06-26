import { it, describe, before, after } from 'node:test'
import { start, stop } from './utils.js'
import { second } from './tools.js'

void describe( '01.spec', () => {
  before(start, { timeout: 12*second })
  after(stop, { timeout: 12*second })

  void it('01-ok', async () => { return })
})
