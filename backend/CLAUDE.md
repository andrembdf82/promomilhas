# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WhatsApp bot backend built with Node.js that uses `whatsapp-web.js` to connect to WhatsApp Web. It runs a WebSocket server to broadcast WhatsApp events to connected clients in real-time.

## Core Architecture

### Main Components

- **WhatsApp Client** (`index.js:9-27`): Uses the `whatsapp-web.js` library to create a WhatsApp client with:
  - Local authentication (session data stored in `./sessions`)
  - Chromium/Puppeteer for WhatsApp Web automation
  - Auto-restart on auth failures

- **WebSocket Server** (`index.js:31-54`): Listens on port 3001 and:
  - Maintains a list of connected sockets in the `sockets` array
  - Sends messages via the `broadcast()` function (`index.js:56-67`)
  - Handles client connections, disconnections, and errors

- **Message Processing** (`index.js:150-224`): The `processarMensagem()` function:
  - Handles incoming WhatsApp messages and media
  - Extracts message metadata (sender, chat type, timestamp, etc.)
  - Filters out notification templates
  - Broadcasts relevant events to WebSocket clients
  - Only broadcasts images for media (other types are logged but ignored)

### Event Flow

1. WhatsApp client emits events (message, qr, authenticated, error, etc.)
2. Events trigger handlers that either:
   - Log status changes (`client.on('ready')`, `client.on('change_state')`)
   - Process messages via `processarMensagem()` which broadcasts to WebSocket clients
   - Handle authentication and connection states

### Data Flow

WebSocket clients receive broadcasted events as JSON objects with these message types:
- `status`: Connection/authentication status updates
- `message`: Text messages from WhatsApp
- `media`: Image media from WhatsApp

## Development Commands

```bash
# Start the bot
npm start

# (No other scripts currently configured)
```

## Key Configuration Points

- **WhatsApp Session Storage**: `./sessions/` directory
- **WebSocket Port**: `3001`
- **Puppeteer Options** (`index.js:14-23`): Running headless mode with various sandbox/GPU/memory flags for reliability
- **Connection Timeouts**: 10-second takeover timeout for conflict resolution

## Important Notes for Development

1. **Session Persistence**: Authentication credentials are stored in `./sessions/`. Don't commit this directory; add to `.gitignore` if not already present.

2. **QR Code Authentication**: On first run or after logout, the bot generates a QR code in the terminal. Users must scan with WhatsApp to authenticate.

3. **Graceful Shutdown**: The application handles SIGINT, SIGTERM, uncaught exceptions, and unhandled rejections with proper cleanup (`exitHandler`).

4. **Error Recovery**: Messages are wrapped in try-catch blocks to prevent one malformed message from crashing the bot.

5. **Media Handling**: Only image media is broadcasted to WebSocket clients; other media types are logged but filtered out.

6. **Performance**: The application logs connection status every 10 seconds (`setInterval` at `index.js:270`).

7. **Chat Information**: The `safeGetChat()` function (`index.js:138-148`) safely retrieves chat metadata with fallback values if the operation fails.

## Browser Compatibility & Server Setup

The project uses Puppeteer to automate WhatsApp Web. The `puppeteer` configuration is optimized for running on headless servers (EC2, Docker, etc.):

**Puppeteer Arguments:**
- `headless: true` — Required for servers without X11 display. Change to `false` only for local debugging
- `--no-sandbox` and `--disable-setuid-sandbox` — Required for running in containers/restricted environments
- `--disable-gpu` and `--disable-dev-shm-usage` — Memory and GPU optimizations
- `--disable-software-rasterizer` and `--disable-extensions` — Further optimization for headless mode
- `--single-process` — More stable in memory-constrained environments

**Running on AWS EC2:**
- The bot is configured to run headless by default
- No X server or display needed
- Suitable for Amazon Linux 2023 and other minimal Linux distributions

## Session Cache Cleanup

The `sessions/` directory grows over time due to browser cache. The application automatically cleans up unnecessary cache files while preserving authentication data:

- **Automatic Cleanup**: Runs on startup and every 24 hours via `cleanupSessionCache()` function
- **Preserved**: The `Default/` directory (contains cookies and localStorage with auth data)
- **Cleaned**: Cache directories (Cache, Code Cache, File System, CertificateRevocation, etc.) and journal files
- **Interval**: Change the cleanup interval (currently 24 hours) in the `setInterval` call before `client.initialize()`

The `sessions/` directory is ignored in `.gitignore` to prevent committing session data.
