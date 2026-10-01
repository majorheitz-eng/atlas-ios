# Atlas for iPhone

A private, voice-first iPhone client for [Hermes Agent](https://hermes-agent.nousresearch.com/docs). Atlas provides a Siri-like conversation surface while preserving Hermes memory, skills, and tool access.

## Current MVP

- Native iOS speech recognition with interim transcripts
- Streaming Hermes responses over authenticated JSON-RPC/WebSocket
- Spoken replies with interruption support
- Animated Arc Reactor voice control
- Face ID approval for consequential Hermes tool actions
- Secrets stored in iOS Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`)
- Deep link: `atlas://talk` (for the Action Button and Apple Shortcuts)
- Text input fallback and connection diagnostics
- No AI provider credentials compiled into the app

## Architecture

```text
iPhone (Atlas)
  ├─ Apple speech recognition
  ├─ Keychain: gateway URL + revocable access token
  └─ wss:// authenticated connection
       └─ Cloudflare Tunnel (TLS, no inbound port)
            └─ 127.0.0.1:9119/api/ws
                 └─ Hermes Agent (memory, skills, tools, approvals)
```

The Hermes backend remains bound to loopback. The iPhone receives only rendered conversation events and redacted approval requests. Sensitive actions are denied unless the user explicitly approves them; non-deny approvals require Face ID/device authentication.

## Development

Requires Node 22+ and npm.

```bash
npm install
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

`expo-speech-recognition` contains native code, so microphone testing requires an EAS development or production build rather than Expo Go.

### Hermes transport smoke test

Start an isolated local backend:

```bash
HERMES_DASHBOARD_SESSION_TOKEN='replace-me' hermes serve --host 127.0.0.1 --port 9127
```

Then run:

```bash
ATLAS_GATEWAY_URL='http://127.0.0.1:9127' \
ATLAS_GATEWAY_TOKEN='replace-me' \
node scripts/smoke_gateway.mjs
```

A passing test creates a real Hermes session, submits a prompt, receives streamed deltas, and prints `ATLAS IOS LINK OK`.

## iPhone activation

After installation, create an Apple Shortcut named **Ask Atlas** that opens `atlas://talk`. Assign that shortcut to the iPhone Action Button. Siri can then invoke it with **“Siri, Ask Atlas.”**

Apple does not permit a third-party app to replace Siri or continuously monitor a wake phrase in the background. Atlas begins listening immediately when opened through its approved deep link.

## Build and TestFlight

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production
```

The EAS project and Apple signing credentials are configured interactively and must never be committed to this repository.
