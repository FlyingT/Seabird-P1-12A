# 🏷️ Seabird Label Printer – Web App

Web app for printing labels on the **Seabird P1-12A** Bluetooth thermal printer directly from your computer.

Replaces the discontinued Android app "Seabird Sticker Printer" with a browser-based solution using the Web Bluetooth API.

## Features

- **BLE connection** directly in the browser (Chrome/Edge)
- **Label editor** with text, fonts, sizes, and alignment
- **Live preview** at original print resolution
- **Print function** with progress indicator
- **Docker deployment** via GitHub Container Registry

## Prerequisites

- **Browser**: Chrome or Edge (Web Bluetooth required)
- **Bluetooth**: BLE-capable Bluetooth adapter on your computer
- **HTTPS**: Web Bluetooth requires a secure context (`localhost` or HTTPS)

## Quick Start – Docker

Create a `docker-compose.yml`:

```yaml
services:
  label-printer:
    image: ghcr.io/flyingt/seabird-p1-12a:latest
    container_name: seabird-label-printer
    ports:
      - "8081:80"
      - "8443:443"
    environment:
      - HTTPS_PORT=8443
    restart: unless-stopped
```

Then run:

```bash
docker compose up -d
```

Open in your browser: **`https://<your-ip>:8443`**
Accept the certificate warning on first visit – Web Bluetooth will work.

## Local Development

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
# Open http://localhost:8080
```

## Build Docker Image Locally

```bash
docker build -t seabird-label-printer .
docker run -d -p 8081:80 -p 8443:443 -e HTTPS_PORT=8443 seabird-label-printer
```

> **Note – Web Bluetooth & Secure Context**:
> Web Bluetooth requires HTTPS or `localhost`. The Docker image includes a
> self-signed SSL certificate – just accept the browser warning on first visit.
> For a trusted certificate, use a reverse proxy (e.g., Caddy, Traefik).

## Protocol (SSBP)

The proprietary protocol was reverse-engineered from the Seabird Sticker Printer APK (v1.32.9):

| Property | Value |
|---|---|
| BLE Service | `0xFFE0` |
| BLE Characteristic | `0xFFE1` (Write + Notify) |
| Protocol Header | `0xA3` |
| Handshake | `A3 01 00 00 00 10` → Response `0x11` |
| Device Info | `A3 01 00 00 00 35` → Response `0x36` |
| Paper Status | `A3 01 00 00 00 45` → Response `0x46` |
| Print Command | `0x25` + Bitmap (1-bit mono, column-wise) |

## File Structure

```
├── index.html         # Label editor (main app)
├── explorer.html      # BLE explorer (debug tool)
├── style.css          # Styling
├── app.js             # Editor logic
├── printer.js         # BLE + SSBP protocol
├── explorer.js        # Explorer logic
├── nginx.conf         # HTTPS config
├── Dockerfile
├── docker-compose.yml
├── serve.ps1          # Local HTTP server
└── .github/workflows/ # CI/CD: Docker image build
```
