import { type Logger } from 'pino'
import { EslLite } from './lite.js'
import { FreeSwitchResponse } from './response.js'

export const defaults = {
  host: '127.0.0.1',
  port: 8021,
  password: 'ClueCon',
}

/**
 * FreeSwitchClient is the class you use to create a new client.
 * It will automatically reconnect.
 *
 * ```ts
 * const client = new FreeSwitchClient({ logger: pino.default() })
 * const res = await client.bgapi('sofia status', 1000)
 * console.log('sofia status is', res)
 * ```
 */
export class FreeSwitchClient extends FreeSwitchResponse {
  constructor(options: {
    host?: string
    port?: number
    password?: string
    logger: Logger
  }) {
    const host = options?.host ?? defaults.host
    const port = options?.port ?? defaults.port
    const password = options?.password ?? defaults.password
    const logger = options.logger
    super(new EslLite({ host, port, logger }), password, logger)
    process.nextTick(() => {
      super.connect().catch((err: unknown) => {
        logger.error({ err }, 'connect failed')
      })
    })
  }
}
