import { describe, it } from 'node:test'
import pino from 'pino'
import { FreeSwitchClient } from '../src/client.js'

const logger = pino.default({ name: 'test-reconnect', level: 'debug' })

describe('test-reconnect', () => {
  it('test-reconnect: should keep receiving HEARTBEAT', async () => {
    const client = new FreeSwitchClient({ logger, port: 8022 })
    let lastSeen = 0
    let count = 0
    client.on('HEARTBEAT', () => {
      lastSeen = performance.now()
      count++
    })

    let started = performance.now()
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const now = performance.now()
        if (lastSeen === 0) {
          console.log(now, 'no HEARTBEAT received so far')
        } else {
          console.log(
            now,
            `HEARTBEAT received ${(now - lastSeen).toFixed(3)}ms ago, total count ${count}`
          )
        }
        if (now < started + 32_000) {
          console.log(now, 'too early, waiting at least 32s')
          return
        }
        if (now > lastSeen + 32_000) {
          clearInterval(timer)
          client.end()
          if (lastSeen === 0) {
            reject(new Error('More than 32s and no HEARTBEAT'))
          } else {
            reject(new Error('More than 32s since last HEARTBEAT'))
          }
        }
        if (now > started + 110_000) {
          if (lastSeen === 0) {
            clearInterval(timer)
            client.end()
            reject(new Error('Never received any HEARTBEAT'))
          } else {
            clearInterval(timer)
            client.end()
            resolve('Looks good')
          }
        }
      }, 1_000)
    })
    setInterval
  })
})
