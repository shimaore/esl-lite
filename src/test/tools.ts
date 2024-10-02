import { type ChildProcess, spawn } from 'node:child_process'

import { mkdir, rm } from 'node:fs/promises'
import { second, sleep } from '../sleep.js'

import { ulid } from 'ulidx'

export const timer = function (): () => number {
  const now = process.hrtime.bigint()
  return function () {
    return Number(process.hrtime.bigint() - now) / 1_000_000
  }
}

// FIXME: conversion in general terms is more complex, value may contain comma, quote, etc.
export const optionsText = function (
  options: Record<string, string | number>
): string {
  return (function () {
    const results: string[] = []
    for (const key in options) {
      const value = options[key]
      results.push(`${key}=${value}`)
    }
    return results
  })().join(',')
}

let fsClient: ChildProcess | null = null

let fsServer: ChildProcess | null = null

const commonOptions = [
  '-nf', // No forking
  '-c', // Console and foreground
  '-nosql',
  '-nonat', // Disable auto nat detection
  '-nocal', // Disable clock calibration
  '-nort',
  '-conf',
  '/opt/test',
]

export const simpleStartClient = async (
  log: (...values: unknown[]) => void,
  stdio: 'ignore' | 'inherit'
): Promise<void> => {
  const dir = `/tmp/client-${ulid()}`
  log('Starting FS with client profile', { stdio })
  await mkdir(dir)
  fsClient = spawn(
    '/usr/bin/freeswitch',
    [...commonOptions, '-cfgname', 'client.xml', '-log', dir, '-db', dir],
    {
      stdio: [stdio, stdio, 'inherit'],
    }
  )
  if (fsClient != null) {
    fsClient.on('error', function (error) {
      log('fs_client error', error)
    })
    fsClient.once('exit', function (code, signal): void {
      void (async function () {
        log('fs_client exit', { code, signal })
        await rm(dir, {
          recursive: true,
          force: true,
        }).catch(() => true)
        if (code !== 0) {
          process.exit(1)
        }
        fsClient = null
      })()
    })
    await new Promise((resolve) => fsClient?.once('spawn', resolve))
    await sleep(4 * second)
    log('fs_client spawned')
  }
}

export const simpleStartServer = async (
  log: (...values: unknown[]) => void,
  stdio: 'ignore' | 'inherit'
): Promise<void> => {
  const dir = `/tmp/server-${ulid()}`
  log('Starting FS with server profile', { stdio })
  await mkdir(dir)
  fsServer = spawn(
    '/usr/bin/freeswitch',
    [...commonOptions, '-cfgname', 'server.xml', '-log', dir, '-db', dir],
    {
      stdio: [stdio, stdio, 'inherit'],
    }
  )
  fsServer.on('error', function (error) {
    log('fs_server error', error)
  })
  fsServer.once('exit', function (code, signal): void {
    void (async function () {
      log('fs_server exit', { code, signal })
      await rm(dir, {
        recursive: true,
        force: true,
      }).catch(() => true)
      if (code !== 0) {
        process.exit(1)
      }
      fsServer = null
    })()
  })
  await new Promise((resolve) => fsServer?.once('spawn', resolve))
  await sleep(4 * second)
  log('fs_server spawned')
}

export const simpleStop = async (
  log: (...values: unknown[]) => void
): Promise<void> => {
  await sleep(2 * second)
  log('Stopping FS')
  const p =
    fsClient != null
      ? new Promise((resolve) => fsClient?.once('exit', resolve))
      : Promise.resolve(true)
  const q =
    fsServer != null
      ? new Promise((resolve) => fsServer?.once('exit', resolve))
      : Promise.resolve(true)
  if (fsClient != null) {
    fsClient.kill()
    log('fs_client killed')
  }
  if (fsServer != null) {
    fsServer.kill()
    log('fs_server killed')
  }
  await Promise.all([p, q])
  log('Server(s) exited')
}
