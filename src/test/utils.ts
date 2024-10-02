import { simpleStartClient, simpleStartServer, simpleStop } from './tools.js'
import { TestContext } from 'node:test'
import pino from 'pino'

export const DoCatch = function <T>(t: TestContext, f: () => Promise<T>): void {
  void f().catch(t.diagnostic.bind(t))
}

export const start = async (): Promise<void> => {
  await Promise.all([startClient('ignore'), startServer('ignore')])
}

export const clientLogger = function (withDebug = true): pino.Logger {
  return pino.default({
    name: 'clientLogger',
    level: withDebug ? 'trace' : 'info',
  })
}

export const serverLogger = function (): pino.Logger {
  return pino.default({ name: 'serverLogger' })
}

export const responseLogger = function (): pino.Logger {
  return pino.default({ name: 'responseLogger' })
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
