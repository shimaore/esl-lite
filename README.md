# FreeSwitch Event Socket Client

`esl-lite` is a dedicated, optimized, client-only version of the `esl` package for Node.js.

Like `esl`, it is used in production worldwide.

## Which package should I use?

Use `esl` if server mode is required.

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

const client = new FreeSwitchClient({ logger: pino.default() })

client.on('CHANNEL_CREATE', function (msg) {
  // The entire body set is available…
  console.log('CHANNEL_CREATE', msg.body.data)

  // … and common fields are already loaded.
  const uuid = msg.body.uniqueID
  if (uuid) {
    // Send command to a specific channel!
    client.command_uuid(uuid, 'answer', '', 4000).catch( console.error )
  }
})

// Send generic commands
await await.bgapi('originate sofia/profile/sip:destination@host &park')

// For CUSTOM messages with Event-Subclass, use the `.custom` event-emitter.
client.custom.on('conference::maintenance', function (msg) { … })
```

## Documentation

See [FreeSwitchClient](https://shimaore.github.io/esl-lite/classes/client.FreeSwitchClient.html)
and [FreeSwitchResponse](https://shimaore.github.io/esl-lite/classes/response.FreeSwitchResponse.html)
for the main classes.

## Source

The primary repository is https://g.rie.re/shimaore/esl-lite

Also available on [Github](https://github.com/shimaore/esl-lite) and [Gitlab](https://gitlab.com/shimaore/esl-lite).

## About

Written by [Stéphane Alnet](https://del.igh.tf/ul/stephane-alnet/)

## Changelog

### v2.0.0

- added automatic `event json` when subscribing to events
- made `.event_json` method private since it is no longer needed
  — added `service.custom` event-emitter to properly serve CUSTOM events
