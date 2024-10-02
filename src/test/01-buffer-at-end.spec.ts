import { it } from 'node:test'
import { FreeSwitchClient } from '../esl-lite.js'

import { createServer } from 'node:net'

import { sleep } from '../sleep.js'
import { clientLogger } from './utils.js'
import assert from 'node:assert'

const clientPort = 5621

void it('01-buffer-at-end: should be empty at end of stream', async () => {
  const logger = clientLogger()
  await new Promise((resolve, reject) => {
    try {
      const spoof = createServer({
        keepAlive: true,
      })
      spoof.on('connection', function (c) {
        c.write(`Content-Type: auth/request

`)
        c.on('data', function (): void {
          void (async function (): Promise<void> {
            try {
              await sleep(250)
              c.write(`
Content-Type: command/reply
Reply-Text: +OK accepted

Content-Type: text/disconnect-notice
Content-Length: 3

Disconnected, filling your buffer with junk.
`)
            } catch (err: unknown) {
              logger.error({ err })
              reject(err as Error)
            }
            c.end()
          })()
        })
      })
      spoof.on('listening', function () {
        logger.info('Server ready')
      })
      spoof.listen({
        port: clientPort,
      })
      ;(async () => {
        const client = new FreeSwitchClient({
          host: '127.0.0.1',
          port: clientPort,
          logger,
        })
        await sleep(1000)
        client.end()
        spoof.close()
        assert(
          client.stats.nonEmptyBufferAtEnd > 0n,
          'Buffer is empty at end of stream'
        )
      })().then(resolve, reject)
    } catch (error: unknown) {
      logger.info(`buffer-at-end: unexpected failure ${error as Error}`)
      reject(error as Error)
    }
  })
})
