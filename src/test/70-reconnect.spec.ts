import { it } from 'node:test'

import { FreeSwitchClient, FreeSwitchTimeoutError } from '../esl-lite.js'

import { type Socket, createServer } from 'node:net'
import { sleep } from '../sleep.js'
import { clientLogger } from './utils.js'
import assert from 'node:assert'
import { type Logger } from 'pino'

const clientPort = 5623

const createService = (logger: Logger) => {

  let run = 0
  const result = { success: false, service: function (c: Socket): void {
    run++
    logger.info(`Server run #${run} received connection`)
    c.on('error', function (error) {
      logger.info(`Server run #${run} received error ${error}`)
    })
    let processed = false
    c.on('data', function (data): void {
      logger.info(`Server run #${run} received data ${data.toString()}`)
      void (async function () {
        try {
          switch (run) {
            case 1:
              logger.info('Server run #1 sleeping')
              await sleep(500)
              logger.info('Server run #1 close')
              c.destroy()
              break
            case 2:
              if (processed) {
                return
              }
              processed = true
              logger.info('Server run #2 writing (re-auth)')
              c.write('Content-Type: auth/request\n\n')
              logger.info('Server run #2 sleeping')
              await sleep(500)
              logger.info('Server run #2 writing (reply)')
              c.write(`
Content-Type: command/reply
Reply-Text: +OK accepted

Content-Type: text/disconnect-notice
Content-Length: 0

`)
              logger.info('Server run #2 sleeping')
              await sleep(50)
              logger.info('Server run #2 end')
              c.end()
              break
            case 3:
              logger.info('Server run #3 end')
              c.end()
              logger.info('Server run #3 close')
              result.success = true
          }
        } catch (err) {
          logger.error({ err })
          result.success = false
        }
      })()
    })
    c.resume()
    c.write('Content-Type: auth/request\n\n')
    logger.info(`Server run #${run} sent auth/request`)
  }
  }
  return result
}

void it('70 - should reconnect', { timeout: 30000 }, async () => {
  const logger = clientLogger().child({ test: '70a' })

  const s = createService(logger)
  const spoof = createServer(s.service)
  spoof.listen(clientPort, function () {
    logger.info('Server ready')
  })
  spoof.on('close', function () {
    logger.info('Server received close event')
  })

  const client = new FreeSwitchClient({
    host: '127.0.0.1',
    port: clientPort,
    logger,
  })
  await sleep(4_000)
  client.end()
  assert(s.success, 'Should be success')
  spoof.close()
})

void it('70 - should progress bgapi', { timeout: 10000 }, async () => {
  const logger = clientLogger().child({ test: '70b' })

  const s = createService(logger)
  const spoof = createServer(s.service)
  spoof.listen(clientPort+2, function () {
    logger.info('71 - Server ready')
  })
  spoof.on('close', function () {
    logger.info('71 - Server received close event')
  })

  const client = new FreeSwitchClient({
    host: '127.0.0.1',
    port: clientPort+2,
    logger,
  })
  const outcome = await client.bgapi('test issue 4', 4_000)
  client.end()
  assert(s.success, 'Should be success')
  assert(
    outcome instanceof FreeSwitchTimeoutError,
    'Should be FreeSwitchTimeoutError'
  )
  spoof.close()
})
