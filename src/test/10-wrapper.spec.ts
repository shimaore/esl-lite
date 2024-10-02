import { describe, it } from 'node:test'

import { type Socket, createServer } from 'node:net'

import { clientLogger } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { inspect } from 'node:util'
import { sleep } from '../sleep.js'

const clientPort = 5624

void describe('10-wrapper.spec', () => {
  void it('should send commands', { timeout: 30000 }, async function (t) {
    let connection = 0
    const service = function (c: Socket): void {
      t.diagnostic(`Server received ${++connection} connection`)
      c.on('error', (error): void => {
        t.diagnostic(`Server received error ${inspect(error)}`)
      })
      c.on('data', function (originalData) {
        void (async function () {
          try {
            const data = originalData.toString('utf-8')
            t.diagnostic(`Server received data ${inspect(data)}`)
            await sleep(100)
            t.diagnostic('Server writing (reply ok)')
            c.write(`Content-Type: command/reply
Reply-Text: +OK accepted

`)
            if (/bridge[^]*foo/.exec(data) != null) {
              await sleep(100)
              t.diagnostic('Server writing (execute-complete for bridge)')
              const $ = /Event-UUID: (\S+)/i.exec(data)
              if ($?.[1] != null) {
                const eventUUID = $[1]
                const msg = `Content-Type: text/event-plain
Content-Length: ${97 + eventUUID.length}

Event-Name: CHANNEL_EXECUTE_COMPLETE
Application: bridge
Application-Data: foo
Application-UUID: ${eventUUID}

`
                c.write(msg)
              }
            }
            if (/ping[^]*bar/.exec(data) != null) {
              await sleep(100)
              t.diagnostic('Server writing (execute-complete for ping)')
              const $ = /Event-UUID: (\S+)/i.exec(data)
              if ($?.[1] != null) {
                const eventUUID = $[1]
                const msg = `
Content-Type: text/event-plain
Content-Length: ${95 + eventUUID.length}

Event-Name: CHANNEL_EXECUTE_COMPLETE
Application: ping
Application-Data: bar
Application-UUID: ${eventUUID}

`
                c.write(msg)
              }
            }
          } catch (ex) {
            t.diagnostic(inspect(ex))
            // FIXME, probably
            throw ex
          }
        })()
      })
      c.on('end', function () {
        t.diagnostic('Server end')
      })
      c.resume()
      t.diagnostic('Server writing (auth)')
      c.write(`
Content-Type: auth/request

`)
    }
    const spoof = createServer(service)
    spoof.listen(clientPort, function () {
      t.diagnostic('Server ready')
    })
    spoof.on('close', function () {
      t.diagnostic('Server received close event')
    })
    const w = new FreeSwitchClient({
      host: '127.0.0.1',
      port: clientPort,
      logger: clientLogger(),
    })
    t.diagnostic('Awaiting FreeSwitchResponse object')
    await w.command_uuid('1234', 'bridge', 'foo', 500)
    t.diagnostic('Client sending again')
    await w.command_uuid('1234', 'ping', 'bar', 500)
    t.diagnostic('Client requesting end')
    w.end()
    spoof.close()
  })
})
