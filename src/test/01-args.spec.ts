import test from 'ava'

import { FreeSwitchClosedError, FreeSwitchResponse } from '../esl-lite.js'
import { type Socket } from 'net'
import { responseLogger as logger } from './utils.js'

const socket = {
  once: function () {},
  on: function () {},
  end: function () {},
  write: function () {},
  setKeepAlive: function () {},
  setNoDelay: function () {},
  forEach: function () {},
} as unknown as Socket

test('01-args: should report properly on closed (bgapi)', async function (t) {
  const T = new FreeSwitchResponse(socket, logger(t))
  T.closed = true
  const res = await T.bgapi('foo', 1000)
  t.log('Result', res)
  t.true(res instanceof FreeSwitchClosedError, 'Expect FreeSwitchClosedError')
})
