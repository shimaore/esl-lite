import { it } from 'node:test'

import { FreeSwitchClient } from '../esl-lite.js'

import { type Socket, createServer } from 'node:net'
import { sleep } from './tools.js'
import { clientLogger } from './utils.js'
import { inspect } from 'node:util'

const clientPort = 5623

it('should reconnect', { timeout: 30000 }, (t) => {
  return new Promise((resolve, reject) => {
    const start = function (): void {
      let run = 0
      const service = function (c: Socket): void {
        run++
        t.diagnostic(`Server run #${run} received connection`)
        c.on('error', function (error) {
          t.diagnostic(`Server run #${run} received error ${error}`)
        })
        c.on('data', function (data): void {
          void (async function () {
            try {
              t.diagnostic(`Server run #${run} received data ${data}`)
              switch (run) {
                case 1:
                  t.diagnostic('Server run #1 sleeping')
                  await sleep(500)
                  t.diagnostic('Server run #1 close')
                  c.destroy()
                  break
                case 2:
                  t.diagnostic('Server run #2 writing (auth)')
                  c.write(`Content-Type: auth/request

`)
                  t.diagnostic('Server run #2 sleeping')
                  await sleep(500)
                  t.diagnostic('Server run #2 writing (reply)')
                  c.write(`
Content-Type: command/reply
Reply-Text: +OK accepted

Content-Type: text/disconnect-notice
Content-Length: 0
`)
                  t.diagnostic('Server run #2 sleeping')
                  await sleep(500)
                  t.diagnostic('Server run #2 end')
                  c.end()
                  break
                case 3:
                  t.diagnostic('Server run #3 end')
                  try {
                    client.end()
                  } catch (error) {
                    t.diagnostic(inspect(error))
                  }
                  c.end()
                  t.diagnostic('Server run #3 close')
                  spoof.close()
                  resolve()
              }
            } catch (ex) {
              t.diagnostic(inspect(ex))
              reject()
            }
          })()
        })
        c.resume()
        c.write(`Content-Type: auth/request

`)
      }
      const spoof = createServer(service)
      spoof.listen(clientPort, function () {
        t.diagnostic('Server ready')
      })
      spoof.on('close', function () {
        t.diagnostic('Server received close event')
      })
    }
    start()
    const client = new FreeSwitchClient({
      host: '127.0.0.1',
      port: clientPort,
      logger: clientLogger(),
    })
    client.on('error', function (error) {
      t.diagnostic(`client error ${error}`)
    })
    client.connect()
  })
})
