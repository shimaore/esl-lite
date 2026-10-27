/**
 * Regression test: `end()` must close the socket even when the remote end
 * never answers our FIN.
 *
 * Root cause (socket.ts): the 'end' handler only calls `socket.end()`, which
 * sends our FIN and half-closes the socket. The socket only closes once the
 * remote end sends its own FIN. A peer that keeps its side open (a stuck or
 * overloaded process, a dropped path) leaves the socket, its parser and the
 * `connect()` loop alive until TCP keepalive gives up, which takes hours with
 * the default settings.
 *
 * Fix: destroy the socket if it has not closed within END_FORCE_CLOSE_MS of
 * `end()`, and treat 'close' as the end of the connection.
 */

import { it } from 'node:test'
import assert from 'node:assert'
import { createServer, type Socket } from 'node:net'
import { EslLite } from '../lite.js'
import { sleep } from '../sleep.js'
import { clientLogger } from './utils.js'

const PORT = 5673

void it(
  '72 - end() closes the socket when the remote end never sends FIN',
  { timeout: 20_000 },
  async () => {
    let connected = false
    let remoteSawFin = false
    const serverSockets: Socket[] = []
    // allowHalfOpen: the server keeps its side open after the client's FIN.
    const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
      connected = true
      serverSockets.push(socket)
      socket.on('error', () => {})
      socket.once('end', () => {
        remoteSawFin = true
      })
      socket.write('Content-Type: auth/request\n\n')
    })

    await new Promise<void>((resolve) => server.listen(PORT, resolve))

    const logger = clientLogger(false)
    const lite = new EslLite({ host: '127.0.0.1', port: PORT, logger })

    let loopDone = false
    const connectLoop = (async () => {
      for await (const _event of lite.connect()) {
        /* consume events */
      }
      loopDone = true
    })()

    const deadline = Date.now() + 5_000
    while (!connected && Date.now() < deadline) {
      await sleep(50)
    }
    assert(connected, 'Expected the client to connect')

    const endedAt = Date.now()
    lite.end()
    await Promise.race([connectLoop, sleep(5_000)])
    const elapsed = Date.now() - endedAt

    serverSockets.forEach((socket) => socket.destroy())
    server.close()

    assert(remoteSawFin, 'Expected the server to receive the client FIN')
    assert(
      loopDone,
      `Expected connect() to finish after end() although the remote end ` +
        `never sent FIN; still running after ${elapsed} ms`
    )
    assert(
      elapsed < 4_000,
      `Expected the socket to be destroyed about 2 s after end(); took ${elapsed} ms`
    )
  }
)
