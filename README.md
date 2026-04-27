# 🏷️ Seabird Label Printer – Web App

Web app for printing labels on the **Seabird P1-12A** Bluetooth thermal printer directly from your computer.

Replaces the discontinued Android app "Seabird Sticker Printer" with a browser-based solution using the Web Bluetooth API. Vibe-Coded with Antigravity + Claude and Gemini.

## 🚀 Live Demo

Try it out directly in your browser without installation:
**[https://flyingt.github.io/Seabird-P1-12A/](https://flyingt.github.io/Seabird-P1-12A/)**

*(Note: Web Bluetooth requires Chrome/Edge and a Bluetooth-capable device. Ensure your printer is turned on.)*

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