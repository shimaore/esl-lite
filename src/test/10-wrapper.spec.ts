import { describe, it } from 'node:test'

import { type Socket, createServer } from 'node:net'

import { sleep } from './tools.js'
import { clientLogger, onceConnected } from './utils.js'
import { FreeSwitchClient } from '../esl-lite.js'
import { inspect } from 'node:util'

const clientPort = 5624

describe('10-wrapper.spec', () => {
it('should send commands', { timeout: 30000 }, async function (t) {
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
          if (data.match(/bridge[^]*foo/) != null) {
            await sleep(100)
            t.diagnostic('Server writing (execute-complete for bridge)')
            const $ = data.match(/Event-UUID: (\S+)/i)
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
          if (data.match(/ping[^]*bar/) != null) {
            await sleep(100)
            t.diagnostic('Server writing (execute-complete for ping)')
            const $ = data.match(/Event-UUID: (\S+)/i)
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
  t.diagnostic('Awaiting connect')
  w.connect()
  t.diagnostic('Awaiting FreeSwitchResponse object')
  const call = await onceConnected(w)
  t.diagnostic('Client is connected')
  await call.command_uuid('1234', 'bridge', 'foo', 500)
  t.diagnostic('Client sending again')
  await call.command_uuid('1234', 'ping', 'bar', 500)
  t.diagnostic('Client requesting end')
  call.end('Test completed')
  w.end()
  spoof.close()
})
})
