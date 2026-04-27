/**
 * BLE Explorer – Seabird P1-12A Label Printer
 * Web Bluetooth API integration for service/characteristic discovery
 * and protocol reverse engineering.
 */

// ============================================================
// State
// ============================================================
const state = {
  device: null,
  server: null,
  services: [],
  characteristics: new Map(), // uuid -> characteristic
  selectedChar: null,
  notifySubscriptions: new Set(),
};

// ============================================================
// DOM References
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  connectBtn: $('#connect-btn'),
  disconnectBtn: $('#disconnect-btn'),
  statusIndicator: $('#status-indicator'),
  statusText: $('#status-text'),
  servicesList: $('#services-list'),
  consoleArea: $('#console-area'),
  hexInput: $('#hex-input'),
  sendBtn: $('#send-btn'),
  readBtn: $('#read-btn'),
  notifyBtn: $('#notify-btn'),
  clearLogBtn: $('#clear-log-btn'),
  exportLogBtn: $('#export-log-btn'),
  selectedCharInfo: $('#selected-char-info'),
  selectedCharName: $('#selected-char-name'),
  charActions: $('#char-actions'),
};

// ============================================================
// Logger
// ============================================================
function log(message, type = '') {
  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const now = new Date();
  const time = now.toLocaleTimeString('de-DE', { hour12: false });
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  entry.innerHTML = `
    <span class="log-time">[${time}.${ms}]</span>
    <span class="log-msg ${type}">${escapeHtml(message)}</span>
  `;

  dom.consoleArea.appendChild(entry);
  dom.consoleArea.scrollTop = dom.consoleArea.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Hex Utilities
// ============================================================
function hexToBytes(hex) {
  hex = hex.replace(/\s+/g, '').replace(/0x/gi, '');
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function bytesToAscii(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
    .join('');
}

// ============================================================
// Known BLE UUIDs → friendly names
// ============================================================
const KNOWN_SERVICES = {
  '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
  '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
  '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
  '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
  '0000ffe0-0000-1000-8000-00805f9b34fb': '⭐ Seabird Mode 1 (0xFFE0)',
  '0000ff00-0000-1000-8000-00805f9b34fb': '⭐ Seabird Mode 2 (0xFF00)',
  '0000fff0-0000-1000-8000-00805f9b34fb': '⭐ Seabird Mode 3 (0xFFF0)',
  '0000ae00-0000-1000-8000-00805f9b34fb': 'Custom (0xAE00)',
  '0000ae30-0000-1000-8000-00805f9b34fb': 'Custom (0xAE30)',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455': 'ISSC Transparent UART',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2': 'Custom UART RX/TX',
};

const KNOWN_CHARS = {
  '00002a00-0000-1000-8000-00805f9b34fb': 'Device Name',
  '00002a01-0000-1000-8000-00805f9b34fb': 'Appearance',
  '00002a04-0000-1000-8000-00805f9b34fb': 'Peripheral Preferred Connection Parameters',
  '00002a05-0000-1000-8000-00805f9b34fb': 'Service Changed',
  '00002a19-0000-1000-8000-00805f9b34fb': 'Battery Level',
  '00002a24-0000-1000-8000-00805f9b34fb': 'Model Number String',
  '00002a25-0000-1000-8000-00805f9b34fb': 'Serial Number String',
  '00002a26-0000-1000-8000-00805f9b34fb': 'Firmware Revision String',
  '00002a27-0000-1000-8000-00805f9b34fb': 'Hardware Revision String',
  '00002a28-0000-1000-8000-00805f9b34fb': 'Software Revision String',
  '00002a29-0000-1000-8000-00805f9b34fb': 'Manufacturer Name String',
  // Seabird Mode 1
  '0000ffe1-0000-1000-8000-00805f9b34fb': '⭐ Seabird M1 Write+Read (0xFFE1)',
  // Seabird Mode 2
  '0000ff01-0000-1000-8000-00805f9b34fb': '⭐ Seabird M2 Read/Notify (0xFF01)',
  '0000ff02-0000-1000-8000-00805f9b34fb': '⭐ Seabird M2 Write (0xFF02)',
  // Seabird Mode 3
  '0000fff1-0000-1000-8000-00805f9b34fb': '⭐ Seabird M3 Read/Notify (0xFFF1)',
  '0000fff2-0000-1000-8000-00805f9b34fb': '⭐ Seabird M3 Write (0xFFF2)',
  '0000ae01-0000-1000-8000-00805f9b34fb': 'Custom (0xAE01)',
  '0000ae02-0000-1000-8000-00805f9b34fb': 'Custom (0xAE02)',
  '0000ae03-0000-1000-8000-00805f9b34fb': 'Custom (0xAE03)',
  '49535343-1e4d-4bd9-ba61-23c647249616': 'ISSC TX',
  '49535343-8841-43f4-a8d4-ecbe34729bb3': 'ISSC RX',
};

function getServiceName(uuid) {
  return KNOWN_SERVICES[uuid] || 'Unknown Service';
}

function getCharName(uuid) {
  return KNOWN_CHARS[uuid] || 'Unknown Characteristic';
}

function shortUuid(uuid) {
  // If it's a standard BLE 16-bit UUID, show short form
  const match = uuid.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  if (match) return `0x${match[1].toUpperCase()}`;
  return uuid;
}

// ============================================================
// Connection Management
// ============================================================
async function connectDevice() {
  if (!navigator.bluetooth) {
    log('Web Bluetooth API wird nicht unterstützt! Bitte Chrome oder Edge verwenden.', 'error');
    return;
  }

  try {
    setStatus('connecting');
    log('Suche nach Bluetooth-Geräten...', 'info');

    // Request device with the known Seabird printer service UUIDs
    // Found via APK analysis: 3 possible BLE service modes
    const SEABIRD_SERVICES = [
      '0000ffe0-0000-1000-8000-00805f9b34fb', // Mode 1: FFE0 (write/read: FFE1)
      '0000ff00-0000-1000-8000-00805f9b34fb', // Mode 2: FF00 (write: FF02, read: FF01)
      '0000fff0-0000-1000-8000-00805f9b34fb', // Mode 3: FFF0 (write: FFF2, read: FFF1)
      '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
      '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
      '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
    ];

    state.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SEABIRD_SERVICES
    });

    log(`Gerät gefunden: ${state.device.name || 'Unbekannt'} (${state.device.id})`, 'success');

    // Listen for disconnect
    state.device.addEventListener('gattserverdisconnected', onDisconnected);

    // Connect to GATT server
    log('Verbinde mit GATT-Server...', 'info');
    state.server = await state.device.gatt.connect();
    log('GATT-Server verbunden!', 'success');

    setStatus('connected', state.device.name);

    // Discover services
    await discoverServices();

  } catch (err) {
    if (err.name === 'NotFoundError') {
      log('Kein Gerät ausgewählt.', 'warn');
    } else {
      log(`Verbindungsfehler: ${err.message}`, 'error');
    }
    setStatus('disconnected');
  }
}

async function disconnectDevice() {
  if (state.device && state.device.gatt.connected) {
    // Unsubscribe from all notifications
    for (const charUuid of state.notifySubscriptions) {
      const char = state.characteristics.get(charUuid);
      if (char) {
        try {
          await char.stopNotifications();
        } catch (e) { /* ignore */ }
      }
    }
    state.notifySubscriptions.clear();
    state.device.gatt.disconnect();
    log('Verbindung getrennt.', 'warn');
  }
  setStatus('disconnected');
}

function onDisconnected() {
  log('Verbindung verloren!', 'error');
  setStatus('disconnected');
  state.server = null;
  state.services = [];
  state.characteristics.clear();
  state.selectedChar = null;
  state.notifySubscriptions.clear();
  updateSelectedCharUI();
}

function setStatus(status, deviceName) {
  dom.statusIndicator.className = 'status-indicator';
  if (status === 'connected') {
    dom.statusIndicator.classList.add('connected');
    dom.statusText.innerHTML = `Verbunden mit <span class="device-name">${escapeHtml(deviceName || 'Gerät')}</span>`;
    dom.connectBtn.classList.add('hidden');
    dom.disconnectBtn.classList.remove('hidden');
  } else if (status === 'connecting') {
    dom.statusIndicator.classList.add('connecting');
    dom.statusText.textContent = 'Verbinde...';
    dom.connectBtn.disabled = true;
  } else {
    dom.statusText.textContent = 'Nicht verbunden';
    dom.connectBtn.classList.remove('hidden');
    dom.connectBtn.disabled = false;
    dom.disconnectBtn.classList.add('hidden');
  }
}

// ============================================================
// Service & Characteristic Discovery
// ============================================================
async function discoverServices() {
  try {
    log('Entdecke Services...', 'info');
    const services = await state.server.getPrimaryServices();
    state.services = services;

    log(`${services.length} Service(s) gefunden!`, 'success');

    dom.servicesList.innerHTML = '';

    for (const service of services) {
      const serviceUuid = service.uuid;
      const serviceName = getServiceName(serviceUuid);
      log(`  📦 Service: ${serviceName} [${shortUuid(serviceUuid)}]`, 'info');

      // Get characteristics
      let chars = [];
      try {
        chars = await service.getCharacteristics();
      } catch (e) {
        log(`    ⚠ Konnte Characteristics nicht lesen: ${e.message}`, 'warn');
      }

      // Build service DOM
      const serviceEl = document.createElement('div');
      serviceEl.className = 'service-item';

      let charsHtml = '';
      for (const char of chars) {
        const charUuid = char.uuid;
        const charName = getCharName(charUuid);
        const props = getCharProperties(char);

        // Store reference
        state.characteristics.set(charUuid, char);

        const propsHtml = props
          .map((p) => `<span class="prop-badge ${p.class}">${p.label}</span>`)
          .join('');

        log(`    📝 ${charName} [${shortUuid(charUuid)}] – ${props.map((p) => p.label).join(', ')}`, '');

        charsHtml += `
          <div class="char-item" data-uuid="${charUuid}" onclick="selectCharacteristic('${charUuid}')">
            <div class="char-name">${charName}</div>
            <div class="char-uuid">${shortUuid(charUuid)}</div>
            <div class="char-props">${propsHtml}</div>
          </div>
        `;
      }

      serviceEl.innerHTML = `
        <div class="service-header">
          <div class="service-icon">📦</div>
          <div>
            <div class="service-name">${serviceName}</div>
            <div class="service-uuid">${shortUuid(serviceUuid)}</div>
          </div>
        </div>
        <div class="char-list">${charsHtml || '<div style="color:var(--text-muted);font-size:0.8rem;">Keine Characteristics</div>'}</div>
      `;

      dom.servicesList.appendChild(serviceEl);
    }

    log('Discovery abgeschlossen!', 'success');

    // Auto-read Device Information if available
    await autoReadDeviceInfo();

  } catch (err) {
    log(`Discovery-Fehler: ${err.message}`, 'error');
  }
}

function getCharProperties(char) {
  const props = [];
  const p = char.properties;
  if (p.read) props.push({ label: 'Read', class: 'read' });
  if (p.write) props.push({ label: 'Write', class: 'write' });
  if (p.writeWithoutResponse) props.push({ label: 'Write No Resp', class: 'write-no-resp' });
  if (p.notify) props.push({ label: 'Notify', class: 'notify' });
  if (p.indicate) props.push({ label: 'Indicate', class: 'indicate' });
  return props;
}

// ============================================================
// Auto-read standard characteristics
// ============================================================
async function autoReadDeviceInfo() {
  const infoChars = [
    '00002a00-0000-1000-8000-00805f9b34fb', // Device Name
    '00002a24-0000-1000-8000-00805f9b34fb', // Model Number
    '00002a25-0000-1000-8000-00805f9b34fb', // Serial Number
    '00002a26-0000-1000-8000-00805f9b34fb', // Firmware Rev
    '00002a27-0000-1000-8000-00805f9b34fb', // Hardware Rev
    '00002a28-0000-1000-8000-00805f9b34fb', // Software Rev
    '00002a29-0000-1000-8000-00805f9b34fb', // Manufacturer Name
    '00002a19-0000-1000-8000-00805f9b34fb', // Battery Level
  ];

  for (const uuid of infoChars) {
    const char = state.characteristics.get(uuid);
    if (char && char.properties.read) {
      try {
        const value = await char.readValue();
        const name = getCharName(uuid);
        if (uuid === '00002a19-0000-1000-8000-00805f9b34fb') {
          // Battery level is a uint8
          log(`  🔋 ${name}: ${value.getUint8(0)}%`, 'success');
        } else {
          const text = new TextDecoder().decode(value);
          log(`  ℹ️ ${name}: "${text}"`, 'success');
        }
      } catch (e) {
        // silently skip unreadable chars
      }
    }
  }
}

// ============================================================
// Characteristic Selection & Interaction
// ============================================================
function selectCharacteristic(uuid) {
  // Update visual selection
  $$('.char-item').forEach((el) => el.classList.remove('selected'));
  const selectedEl = $(`.char-item[data-uuid="${uuid}"]`);
  if (selectedEl) selectedEl.classList.add('selected');

  const char = state.characteristics.get(uuid);
  if (!char) return;

  state.selectedChar = char;
  updateSelectedCharUI();
  log(`Characteristic ausgewählt: ${getCharName(uuid)} [${shortUuid(uuid)}]`, 'info');
}

function updateSelectedCharUI() {
  if (!state.selectedChar) {
    dom.selectedCharInfo.textContent = 'Klicke auf eine Characteristic links um sie auszuwählen';
    dom.charActions.classList.add('hidden');
    return;
  }

  const char = state.selectedChar;
  const uuid = char.uuid;
  const name = getCharName(uuid);
  const props = getCharProperties(char);
  const propsStr = props.map((p) => p.label).join(', ');

  dom.selectedCharInfo.innerHTML = `
    <strong>${name}</strong><br>
    <span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--text-muted)">${shortUuid(uuid)}</span><br>
    <span style="font-size:0.78rem;color:var(--text-secondary)">Eigenschaften: ${propsStr}</span>
  `;

  dom.charActions.classList.remove('hidden');

  // Enable/disable buttons based on properties
  dom.readBtn.disabled = !char.properties.read;
  dom.sendBtn.disabled = !(char.properties.write || char.properties.writeWithoutResponse);
  dom.hexInput.disabled = !(char.properties.write || char.properties.writeWithoutResponse);
  dom.notifyBtn.disabled = !(char.properties.notify || char.properties.indicate);

  // Update notify button state
  const isSubscribed = state.notifySubscriptions.has(uuid);
  dom.notifyBtn.textContent = isSubscribed ? '🔕 Notify Stop' : '🔔 Notify';
  dom.notifyBtn.className = isSubscribed ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-ghost';
}

// ============================================================
// Read / Write / Notify
// ============================================================
async function readCharacteristic() {
  if (!state.selectedChar) return;
  const char = state.selectedChar;
  const uuid = char.uuid;

  try {
    log(`Lese ${getCharName(uuid)}...`, 'info');
    const value = await char.readValue();
    const hex = bytesToHex(value.buffer);
    const ascii = bytesToAscii(value.buffer);
    log(`◀ RX [${shortUuid(uuid)}] HEX: ${hex}`, 'data-in');
    log(`◀ RX [${shortUuid(uuid)}] ASCII: "${ascii}"`, 'data-in');
  } catch (err) {
    log(`Lesefehler: ${err.message}`, 'error');
  }
}

async function writeCharacteristic() {
  if (!state.selectedChar) return;
  const char = state.selectedChar;
  const uuid = char.uuid;
  const hexStr = dom.hexInput.value.trim();

  if (!hexStr) {
    log('Kein Hex-Wert eingegeben!', 'warn');
    return;
  }

  try {
    const bytes = hexToBytes(hexStr);
    log(`▶ TX [${shortUuid(uuid)}] HEX: ${bytesToHex(bytes.buffer)}`, 'data-out');

    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(bytes);
    } else {
      await char.writeValueWithResponse(bytes);
    }
    log('Gesendet ✓', 'success');
  } catch (err) {
    log(`Schreibfehler: ${err.message}`, 'error');
  }
}

async function toggleNotify() {
  if (!state.selectedChar) return;
  const char = state.selectedChar;
  const uuid = char.uuid;

  try {
    if (state.notifySubscriptions.has(uuid)) {
      await char.stopNotifications();
      char.removeEventListener('characteristicvaluechanged', onNotification);
      state.notifySubscriptions.delete(uuid);
      log(`🔕 Notifications gestoppt für ${getCharName(uuid)}`, 'warn');
    } else {
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', onNotification);
      state.notifySubscriptions.add(uuid);
      log(`🔔 Notifications aktiviert für ${getCharName(uuid)}`, 'success');
    }
    updateSelectedCharUI();
  } catch (err) {
    log(`Notify-Fehler: ${err.message}`, 'error');
  }
}

function onNotification(event) {
  const char = event.target;
  const value = event.target.value;
  const hex = bytesToHex(value.buffer);
  const ascii = bytesToAscii(value.buffer);
  log(`🔔 NOTIFY [${shortUuid(char.uuid)}] HEX: ${hex}`, 'data-in');
  if (ascii.replace(/\./g, '').length > 0) {
    log(`🔔 NOTIFY [${shortUuid(char.uuid)}] ASCII: "${ascii}"`, 'data-in');
  }
}

// ============================================================
// Quick Commands
// ============================================================
function sendQuickCmd(hexStr) {
  dom.hexInput.value = hexStr;
  writeCharacteristic();
}

// ============================================================
// Log Management
// ============================================================
function clearLog() {
  dom.consoleArea.innerHTML = '';
  log('Log gelöscht.', 'info');
}

function exportLog() {
  const entries = dom.consoleArea.querySelectorAll('.log-entry');
  let text = `BLE Explorer Log – ${new Date().toISOString()}\n`;
  text += `Device: ${state.device?.name || 'N/A'}\n`;
  text += '='.repeat(60) + '\n\n';

  entries.forEach((entry) => {
    const time = entry.querySelector('.log-time')?.textContent || '';
    const msg = entry.querySelector('.log-msg')?.textContent || '';
    text += `${time} ${msg}\n`;
  });

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ble-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  log('Log exportiert.', 'success');
}

// ============================================================
// Event Listeners
// ============================================================
dom.connectBtn.addEventListener('click', connectDevice);
dom.disconnectBtn.addEventListener('click', disconnectDevice);
dom.readBtn.addEventListener('click', readCharacteristic);
dom.sendBtn.addEventListener('click', writeCharacteristic);
dom.notifyBtn.addEventListener('click', toggleNotify);
dom.clearLogBtn.addEventListener('click', clearLog);
dom.exportLogBtn.addEventListener('click', exportLog);

// Enter key sends hex input
dom.hexInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') writeCharacteristic();
});

// Quick command chips
$$('.cmd-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const cmd = chip.dataset.cmd;
    if (cmd) sendQuickCmd(cmd);
  });
});

// ============================================================
// Init
// ============================================================
log('BLE Explorer bereit. Klicke "Drucker verbinden" um zu starten.', 'info');
log('Benötigt: Chrome oder Edge + Bluetooth-Adapter.', '');
