/**
 * Regression test: 'end' handlers in FreeSwitchSocket.ee must not accumulate
 * across reconnect cycles.
 *
 * Root cause (socket.ts): inside the `while (this.running)` reconnect loop,
 * `this.ee.once('end', () => { socket.end() })` is called on every iteration.
 * The handler is never removed after the iteration completes.
 * FreeSwitchEventEmitter.__once is a Set — each call appends.
 * After N reconnects, __once['end'] holds N handlers, each with a closure
 * over its iteration's (closed) Socket object, pinning those objects in memory.
 *
 * This occurs on every graceful disconnect (FIN) — which is the Linux default
 * when the remote process exits or calls socket.end(). It does NOT require
 * ECONNRESET. In production: FreeSwitch restart → OS sends FIN →
 * ActionLayer reconnects N times while FS is coming back up → N Sockets leaked.
 *
 * Fix: remove the 'end' handler in a finally block at the end of each
 * while-loop iteration so it can't accumulate.
 */

import { it } from 'node:test'
import assert from 'node:assert'
import { createServer, type Socket } from 'node:net'
import { EslLite } from '../lite.js'
import { FreeSwitchSocket } from '../socket.js'
import { sleep } from '../sleep.js'
import { clientLogger } from './utils.js'

const PORT = 5672

void it(
  '71 - no end-handler leak in FreeSwitchSocket across reconnect cycles (FIN)',
  { timeout: 20_000 },
  async () => {
    const RECONNECT_CYCLES = 5

    let connectionCount = 0
    const server = createServer((socket: Socket) => {
      connectionCount++
      const cycle = connectionCount
      socket.on('error', () => {})
      // Mirror half-close so teardown works for the final connection.
      socket.once('end', () => socket.end())
      socket.write('Content-Type: auth/request\n\n')
      if (cycle <= RECONNECT_CYCLES) {
        // Graceful close (FIN) for the first N cycles — simulates FS restart.
        setImmediate(() => socket.end())
      }
      // RECONNECT_CYCLES+1-th connection: stay open so we can inspect state.
    })

    await new Promise<void>((resolve) => server.listen(PORT, resolve))

    const logger = clientLogger(false)
    const lite = new EslLite({ host: '127.0.0.1', port: PORT, logger })

    const connectLoop = (async () => {
      for await (const _event of lite.connect()) {
        /* consume events */
      }
    })()

    // FIN cycles: no retry delay (clean exit, not error path in socket.ts).
    // All RECONNECT_CYCLES+1 connections happen in < 100 ms.
    const deadline = Date.now() + 10_000
    while (connectionCount <= RECONNECT_CYCLES && Date.now() < deadline) {
      await sleep(50)
    }
    assert(
      connectionCount > RECONNECT_CYCLES,
      `Expected ${RECONNECT_CYCLES + 1}+ server connections; got ${connectionCount}`
    )

    // Allow the final connection's 'end' handler to be registered.
    await sleep(100)

    // --- Leak check ---
    // FreeSwitchSocket is private on EslLite, but we need it for the assertion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const sockets = (lite as any).sockets as FreeSwitchSocket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const socketEe = (sockets as any).ee as {
      __once: Record<string, Set<unknown> | undefined>
    }
    const endHandlerCount = socketEe.__once['end']?.size ?? 0

    // Before fix: endHandlerCount === connectionCount (one per cycle, never removed)
    // After fix:  endHandlerCount === 0 or 1 (only the current connection's handler,
    //             if the server left the final connection open)
    //
    // The final server connection was already ended (server calls socket.end()),
    // so the 'end' handler for that cycle has already fired — count should be 0.

    // Teardown
    lite.end()
    server.close()
    await Promise.race([connectLoop, sleep(3_000)])

    // The live (RECONNECT_CYCLES+1-th) connection's handler is still registered
    // because socket.ts is suspended at `yield socket` — its finally block hasn't
    // run yet. All previous handlers must have been removed when their cycles ended.
    assert.strictEqual(
      endHandlerCount,
      1,
      `Expected exactly 1 'end' handler in FreeSwitchSocket.ee.__once ` +
        `(the live connection's); found ${endHandlerCount}. ` +
        `'end' handlers from previous reconnect cycles are not being cleaned up, ` +
        `each holding a reference to a closed Socket object.`
    )
  }
)
