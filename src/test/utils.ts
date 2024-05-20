import {
  type FreeSwitchClient,
  type FreeSwitchResponse,
  type FreeSwitchClientLogger,
  type FreeSwitchParserNonEmptyBufferAtEndError,
} from '../esl-lite.js'
import type * as legacyESL from 'esl'
import {
  second,
  simpleStartClient,
  simpleStartServer,
  simpleStop,
} from './tools.js'
import { type ExecutionContext } from 'ava'

export const DoCatch = function <T>(
  t: ExecutionContext,
  f: () => Promise<T>
): void {
  void f().catch(t.log)
}

export const start = async (
  t: ExecutionContext,
  stdio: 'ignore' | 'inherit' = 'ignore'
): Promise<void> => {
  t.timeout(12 * second)
  await Promise.all([startClient(t, stdio), startServer(t, stdio)])
  t.pass()
}

export const clientLogger = function (
  t: ExecutionContext
): FreeSwitchClientLogger {
  return {
    // debug: (msg, obj) => { t.log('clientLogger:debug', msg, obj) },
    debug: () => {},
    info: (msg, obj) => {
      t.log('clientLogger:info', msg, obj)
    },
    error: (msg, obj) => {
      t.log('clientLogger:error', msg, obj)
    },
  }
}

export const serverLogger = function (
  t: ExecutionContext
): FreeSwitchClientLogger {
  return {
    // debug: (msg, obj) => { t.log('serverLogger:debug', msg, obj) },
    debug: () => {},
    info: (msg, obj) => {
      t.log('serverLogger:info', msg, obj)
    },
    error: (msg, obj) => {
      t.log('serverLogger:error', msg, obj)
    },
  }
}

export const responseLogger = function (
  t: ExecutionContext
): legacyESL.FreeSwitchResponseLogger {
  return {
    // debug: (msg, obj) => { t.log('responseLogger:debug', msg, obj) },
    debug: () => {},
    info: (msg, obj) => {
      t.log('responseLogger:info', msg, obj)
    },
    error: (msg, obj) => {
      t.log('responseLogger:error', msg, obj)
    },
  }
}

export const startClient = async (
  t: ExecutionContext,
  stdio: 'ignore' | 'inherit' = 'ignore'
): Promise<void> => {
  t.timeout(12 * second)
  await simpleStartClient(t.log, stdio)
  t.pass()
}

export const startServer = async (
  t: ExecutionContext,
  stdio: 'ignore' | 'inherit' = 'ignore'
): Promise<void> => {
  t.timeout(12 * second)
  await simpleStartServer(t.log, stdio)
  t.pass()
}

export const stop = async (t: ExecutionContext): Promise<void> => {
  t.timeout(8 * second)
  await simpleStop(t.log)
  t.pass()
}

export const onceConnected = async (
  client: FreeSwitchClient
): Promise<FreeSwitchResponse> => {
  return await new Promise((resolve) => {
    client.once('connect', resolve)
  })
}
export const onceWarning = async (
  client: FreeSwitchClient
): Promise<FreeSwitchParserNonEmptyBufferAtEndError> => {
  return await new Promise((resolve) => {
    client.once('warning', resolve)
  })
}
