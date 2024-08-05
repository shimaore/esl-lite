import {
  type FreeSwitchClient,
  type FreeSwitchResponse,
  type FreeSwitchClientLogger,
  type FreeSwitchParserNonEmptyBufferAtEndError,
} from '../esl-lite.js'
import type * as legacyESL from 'esl'
import {
  simpleStartClient,
  simpleStartServer,
  simpleStop,
} from './tools.js'
import { TestContext } from 'node:test'
import { inspect } from 'node:util'

export const DoCatch = function <T>(
  t: TestContext,
  f: () => Promise<T>
): void {
  void f().catch(t.diagnostic.bind(t))
}

export const start = async (
): Promise<void> => {
  await Promise.all([startClient('ignore'), startServer('ignore')])
}

export const clientLogger = function ( withDebug: boolean = false
): FreeSwitchClientLogger {
  return {
    debug: withDebug ? (msg, obj) => { console.debug('clientLogger:debug', msg, obj) } : () => {},
    info: (msg, obj) => {
      console.info('clientLogger:info', msg, obj)
    },
    error: (msg, obj) => {
      console.error('clientLogger:error', msg, obj)
    },
  }
}

export const serverLogger = function (
): FreeSwitchClientLogger {
  return {
    // debug: (msg, obj) => { t.log('serverLogger:debug', msg, obj) },
    debug: () => {},
    info: (msg, obj) => {
      console.info('serverLogger:info', msg, obj)
    },
    error: (msg, obj) => {
      console.error('serverLogger:error', msg, obj)
    },
  }
}

export const responseLogger = function (
  t: TestContext
): legacyESL.FreeSwitchResponseLogger {
  return {
    // debug: (msg, obj) => { t.log('responseLogger:debug', msg, obj) },
    debug: () => {},
    info: (msg, obj) => {
      t.diagnostic(`responseLogger:info ${inspect(msg)} ${inspect(obj)}`)
    },
    error: (msg, obj) => {
      t.diagnostic(`responseLogger:error ${inspect(msg)} ${inspect(obj)}`)
    },
  }
}

const startClient = async (
  stdio: 'ignore' | 'inherit' = 'ignore'
): Promise<void> => {
  await simpleStartClient((...args) => console.warn(args.join(' ')), stdio)
}

export const startServer = async (
  stdio: 'ignore' | 'inherit' = 'ignore'
): Promise<void> => {
  await simpleStartServer(console.info, stdio)
}

export const stop = async (): Promise<void> => {
  await simpleStop(console.info)
}

export const onceConnected = async (
  client: FreeSwitchClient
): Promise<FreeSwitchResponse> => {
  return client.onceAsync('connect').then( ([call]) => call )
}
export const onceWarning = async (
  client: FreeSwitchClient
): Promise<FreeSwitchParserNonEmptyBufferAtEndError> => {
  return await new Promise((resolve) => {
    client.once('warning', resolve)
  })
}
