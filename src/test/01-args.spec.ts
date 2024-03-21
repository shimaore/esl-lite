import test from 'ava'

import { FreeSwitchResponse } from '../esl-lite.js'
import { type Socket } from 'net'
import { responseLogger as logger } from './utils.js'

const socket = {
  once: function () {},
  on: function () {},
  end: function () {},
  write: function () {},
  setKeepAlive: function () {},
  setNoDelay: function () {},
} as unknown as Socket

test('01-args: should throw properly on closed (bgapi)', async function (t) {
  const T = new FreeSwitchResponse(socket, logger(t))
  T.closed = true
  await T.bgapi('foo', 1000).catch(function (error: any) {
    t.log(error)
    return t.is(error.args.when, 'send on closed socket')
  })
})
