# 🏷️ Seabird Label Printer – Web App

Web-App zum Drucken von Labels auf dem **Seabird P1-12A** Bluetooth-Thermodrucker direkt vom Computer aus.

Ersetzt die Android-App „Seabird Sticker Printer" durch eine browserbasierte Lösung mit Web Bluetooth API.

## Features

- **BLE-Verbindung** direkt im Browser (Chrome/Edge)
- **Label-Editor** mit Text, Schriftart, Größe und Ausrichtung
- **Live-Vorschau** des Labels in Originalgröße
- **Druckfunktion** mit Fortschrittsanzeige
- **Docker-Deployment** via GitHub Container Registry

## Voraussetzungen

- **Browser**: Chrome oder Edge (Web Bluetooth erforderlich)
- **Bluetooth**: BLE-fähiger Bluetooth-Adapter am Computer
- **HTTPS**: Web Bluetooth erfordert einen sicheren Kontext (`localhost` oder HTTPS)

## Schnellstart – Docker

```bash
# docker-compose.yml herunterladen und starten
wget https://raw.githubusercontent.com/FlyingT/Seabird-P1-12A/main/docker-compose.yml
docker compose up -d

# Öffnen: https://192.168.x.x:8443
# (Zertifikatswarnung im Browser akzeptieren)
```

Das Docker Image wird automatisch von GitHub Container Registry (`ghcr.io`) gezogen.
HTTPS mit selbst-signiertem Zertifikat ist integriert – einfach die Warnung im Browser akzeptieren.

## Lokal entwickeln

```powershell
# PowerShell HTTP-Server starten
powershell -ExecutionPolicy Bypass -File serve.ps1

# Dann im Browser öffnen: http://localhost:8080
```

## Docker Image selbst bauen

```bash
docker build -t seabird-label-printer .
docker run -d -p 8081:80 -p 8443:443 -e HTTPS_PORT=8443 seabird-label-printer
```

> **Hinweis – Web Bluetooth & Secure Context**:
> Web Bluetooth erfordert HTTPS oder `localhost`. Das Docker Image enthält
> ein selbst-signiertes SSL-Zertifikat – beim ersten Aufruf die Browser-Warnung akzeptieren.
> Für ein gültiges Zertifikat einen Reverse-Proxy verwenden (z.B. Caddy, Traefik).

## Protokoll (SSBP)

Das proprietäre Protokoll wurde aus der Seabird Sticker Printer APK (v1.32.9) reverse-engineered:

| Eigenschaft | Wert |
|---|---|
| BLE Service | `0xFFE0` |
| BLE Characteristic | `0xFFE1` (Write + Notify) |
| Protokoll-Header | `0xA3` |
| Handshake | `A3 01 00 00 00 10` → Antwort `0x11` |
| Geräteinfo | `A3 01 00 00 00 35` → Antwort `0x36` |
| Papierstatus | `A3 01 00 00 00 45` → Antwort `0x46` |
| Druckbefehl | `0x25` + Bitmap (1-bit Mono, spaltenweise) |

## Dateistruktur

```
├── index.html         # Label-Editor (Haupt-App)
├── explorer.html      # BLE Explorer (Debug-Tool)
├── style.css          # Styling
├── app.js             # Editor-Logik
├── printer.js         # BLE + SSBP Protokoll
├── explorer.js        # Explorer-Logik
├── Dockerfile
├── docker-compose.yml # Nutzt ghcr.io Image
├── serve.ps1          # Lokaler HTTP-Server
└── .github/workflows/ # CI/CD: Docker Image Build
```
