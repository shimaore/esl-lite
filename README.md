# FreeSwitch Event Socket Client

`esl-lite` is a dedicated, optimized, simplified, client-only version of the `esl` package for Node.js.

This package is written in TypeScript, includes JsDoc inline documentation and extensive type definitions (including events), and exposes both CJS and ESM versions.

Like the venerable `esl` package (started in 2011), it is used in production worldwide.

## Which package should I use?

Use `esl` only if server mode is required.

Use `esl-lite` otherwise. Event Socket server-mode does not scale well.

## Installation

```
npm i esl-lite
```

```
yarn add esl-lite
```

## Getting Started

```typescript
import { FreeSwitchClient } from 'esl-lite'
import pino from 'pino'

const logger = pino.default()
const client = new FreeSwitchClient({ logger })

client.on('CHANNEL_CREATE', (msg) => {
  logger.info( msg.body.data, 'new call')

  const uuid = msg.body.uniqueID
  if (uuid) {
    // Send command to a specific channel!
    client.command_uuid(uuid, 'answer', '', 4000).catch( logger.error )
  }
})

// Send generic commands
await await.bgapi('originate sofia/profile/sip:destination@host &park')

// For CUSTOM messages with Event-Subclass, use the `.custom` event-emitter.
client.custom.on('conference::maintenance', (msg) => { … })
```

## Exception reporting

`esl-lite` should never `throw` or `reject`. Instead, all methods report errors using custom classes.
These are clearly listed in the TypeScript return types.

## Documentation

[FreeSwitchClient](https://shimaore.github.io/esl-lite/classes/client.FreeSwitchClient.html)
is the main class and provides most features.

## Source

The primary repository is https://g.rie.re/shimaore/esl-lite

Also available on [Github](https://github.com/shimaore/esl-lite) and [Gitlab](https://gitlab.com/shimaore/esl-lite).

## About

Written by [Stéphane Alnet](https://del.igh.tf/ul/stephane-alnet/)

## Changelog

### v3.0

- simplified: reconnection handling is now hidden
  - missed commands are automatically requeued upon reconnection
- expanded documentation
- added `.logs` event emitter

### v2.0

- added automatic `event json` when subscribing to events
- made `.event_json` method private since it is no longer needed
  — added `.custom` event-emitter to properly serve CUSTOM events
