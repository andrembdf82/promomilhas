# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp bot backend built with Node.js. Connects to WhatsApp Web via `whatsapp-web.js` (Puppeteer/Chromium) and broadcasts incoming messages to WebSocket clients in real-time.

## Development Commands

```bash
npm start        # Start the bot (node index.js)
```

No test suite, linter, or build step is configured.

## Architecture

Single-file application (`index.js`) using ES modules (`"type": "module"` in package.json).

**WhatsApp Client**: Uses `whatsapp-web.js` with `LocalAuth` strategy (sessions stored in `./sessions/`). Runs headless Chromium via Puppeteer with sandbox-disabled flags for server environments. On first run, prints a QR code to the terminal for authentication.

**WebSocket Server**: Listens on port `3001` (configurable via `WS_PORT` env var). Maintains connected clients in a `Set`. The `broadcast()` function sends JSON to all open sockets and cleans up dead connections inline.

**Message Flow**:
1. WhatsApp client emits `message` and `message_create` events
2. Both route to `processMessage()`, which skips `fromMe` messages
3. Media messages (image/video/audio/document) broadcast as `media_notice` type (media is NOT downloaded to save memory)
4. Text messages broadcast as `message` type
5. Auth/connection events broadcast as `status` type

## Key Files

- `index.js` — Active production code
- `index_whatsappweb.js` — Previous version with session cache cleanup (`cleanupSessionCache`)
- `index_old.js` — Minimal original version
- `index - Copia.js` — Backup copy

## Important Details

- **No media downloads**: To keep memory low (targeting AWS t2.micro), media is never downloaded — only a `media_notice` is broadcast with metadata.
- **Status heartbeat**: Logs connection status every 60 seconds via `setInterval`.
- **Graceful shutdown**: Handles SIGINT, SIGTERM, uncaught exceptions, and unhandled rejections. The `shuttingDown` flag prevents double-cleanup.
- **Duplicate prevention**: `message_create` handler also skips `fromMe`, so the same external message may be processed twice (once per event). This is intentional for reliability.
- **Sessions directory**: Contains Chromium profile + auth data. Ignored in `.gitignore`. Do not commit.
- **Dependencies**: Only `whatsapp-web.js` and `qrcode-terminal` (plus `ws` via Node built-in WebSocket server module).
