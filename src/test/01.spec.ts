import { test, it } from 'node:test'
import { start, stop } from './utils.js'
import { second } from './tools.js'

test.before(start, { timeout: 12*second })
test.after(stop, { timeout: 12*second })

it('01-ok', async () => {})
