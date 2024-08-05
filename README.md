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

const client = new FreeSwitchClient()

// FreeSwitchClient will reconnect when needed
client.on('connect', function (service): void {
  // `service` is a FreeSwitchResponse object

  // Listen for FreeSwitch events
  service.on('CHANNEL_CREATE', function (msg) {
    // The entire body set is available…
    console.log('CHANNEL_CREATE', msg.body.data)

    // … and common content is already loaded.
    const uuid = msg.body.uniqueID
    if (uuid) {
      // Send command to a specific channel!
      service.command_uuid(uuid, 'answer', '', 4000)
      // ^^ Notice this returns a Promise and the code should `await` or `catch` it
    }
  })

  // For CUSTOM messages with Event-Subclass, use the `.custom` event-emitter.
  service.custom.on('conference::maintenance', function (msg) {})

  // Send generic commands
  service.bgapi('originate sofia/profile/sip:destination@host &park')
  // ^^ Notice this returns a Promise and the code should `await` or `catch` it
})

client.connect()
```

## Documentation

See [FreeSwitchClient](https://shimaore.github.io/esl-lite/classes/client.FreeSwitchClient.html)
and [FreeSwitchResponse](https://shimaore.github.io/esl-lite/classes/response.FreeSwitchResponse.html)
for the main classes.

## Source

The primary repository is https://g.rie.re/shimaore/esl-lite

Also available on [Github](https://github.com/shimaore/esl-lite) and [Gitlab](https://gitlab.com/shimaore/esl-lite).

## Changelog

### v2.0.0

- added automatic `event json` when subscribing to events
- made `.event_json` method private since it is no longer needed
  — added `service.custom` event-emitter to properly serve CUSTOM events
