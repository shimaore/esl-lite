import { it } from 'node:test'
import {
  FreeSwitchClient,
  FreeSwitchParserNonEmptyBufferAtEndError,
} from '../esl-lite.js'

import { createServer } from 'node:net'

import { sleep } from './tools.js'
import { clientLogger, onceWarning } from './utils.js'
import assert from 'node:assert'

const clientPort = 5621

void it('01-buffer-at-end: should be empty at end of stream', (t) =>
  new Promise((resolve, reject) => {
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
            } catch (ex: any) {
              t.diagnostic(ex.toString())
              reject(ex)
            }
            spoof.close()
          })()
        })
      })
      spoof.on('listening', function () {
        t.diagnostic('Server ready')
      })
      spoof.listen({
        port: clientPort,
      })
      ;(async () => {
        const logger = clientLogger()
        const client = new FreeSwitchClient({
          host: '127.0.0.1',
          port: clientPort,
          logger,
        })
        const pExpect = onceWarning(client)
        client.connect()
        t.diagnostic('buffer-at-end: called connect')
        const error = await pExpect
        t.diagnostic(`buffer-at-end: got error ${error}`)
        assert.strictEqual(
          error instanceof FreeSwitchParserNonEmptyBufferAtEndError,
          true,
          'Buffer is not empty at end of stream'
        )
        client.end()
        spoof.close()
      })().then(resolve, reject)
    } catch (error) {
      t.diagnostic(`buffer-at-end: unexpected failure ${error}`)
      reject(error)
    }
  }))
