/**
 * SeabirdPrinter – BLE + SSBP Protocol for Seabird P1-12A Label Printer
 * Protocol reverse-engineered from Seabird Sticker Printer APK v1.32.9
 */
class SeabirdPrinter {
  constructor() {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.connected = false;
    this.deviceInfo = null;
    this.paperInfo = null;
    this._onStatusChange = null;
    this._onNotify = null;
    this._notifyResolver = null;
    this._responseBuffer = [];
  }

  // BLE Service & Characteristic UUIDs (from APK: CzzBlueCmn.js)
  static SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
  static CHAR_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

  // SSBP Protocol Constants
  static HEADER = 0xA3;
  static CMD_HANDSHAKE = 0x10;
  static CMD_HANDSHAKE_RESP = 0x11;
  static CMD_PRINT = 0x25;
  static CMD_PRINT_RESP = 0x26;
  static CMD_QUERY_DEVICE = 0x35;
  static CMD_QUERY_DEVICE_RESP = 0x36;
  static CMD_QUERY_PAPER = 0x45;
  static CMD_QUERY_PAPER_RESP = 0x46;

  // Default config
  static DEFAULT_PAPER_WIDTH = 96; // pixels (12mm @ 203 DPI)
  static CHUNK_SIZE = 20; // BLE write chunk size in bytes
  static CHUNK_DELAY = 12; // ms between chunks

  set onStatusChange(fn) { this._onStatusChange = fn; }

  _emitStatus(status, detail) {
    this._onStatusChange && this._onStatusChange(status, detail);
  }

  // ── Connection ───────────────────────────────────────────
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported. Please use Chrome or Edge.');
    }

    this._emitStatus('connecting');

    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SeabirdPrinter.SERVICE_UUID]
    });

    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SeabirdPrinter.SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(SeabirdPrinter.CHAR_UUID);

    // Subscribe to notifications
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged', (e) => this._onNotifyData(e));

    this.connected = true;
    this._emitStatus('connected', this.device.name);

    // Handshake + device query
    await this._handshake();
    await this._queryPaper();

    return this.device.name;
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this._onDisconnected();
  }

  _onDisconnected() {
    this.connected = false;
    this.server = null;
    this.characteristic = null;
    this.deviceInfo = null;
    this.paperInfo = null;
    this._emitStatus('disconnected');
  }

  // ── Notification Handler ─────────────────────────────────
  _onNotifyData(event) {
    const value = event.target.value;
    const bytes = Array.from(new Uint8Array(value.buffer));

    // Accumulate response
    this._responseBuffer = this._responseBuffer.concat(bytes);

    // Check if we have a complete message (starts with 0xA3)
    if (this._responseBuffer.length >= 6 && this._responseBuffer[0] === SeabirdPrinter.HEADER) {
      const len = this._responseBuffer[1] | (this._responseBuffer[2] << 8) |
                  (this._responseBuffer[3] << 16) | (this._responseBuffer[4] << 24);
      const totalLen = 5 + len; // header + length bytes + payload

      if (this._responseBuffer.length >= totalLen) {
        const msg = this._responseBuffer.slice(0, totalLen);
        this._responseBuffer = this._responseBuffer.slice(totalLen);

        if (this._notifyResolver) {
          const resolve = this._notifyResolver;
          this._notifyResolver = null;
          resolve(msg);
        }
      }
    }
  }

  _waitForResponse(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      this._notifyResolver = resolve;
      setTimeout(() => {
        if (this._notifyResolver) {
          this._notifyResolver = null;
          reject(new Error('Timeout: No response from printer'));
        }
      }, timeoutMs);
    });
  }

  // ── Protocol Commands ────────────────────────────────────
  async _sendCommand(cmdByte) {
    const data = [SeabirdPrinter.HEADER, 0x01, 0x00, 0x00, 0x00, cmdByte];
    await this._writeChunked(new Uint8Array(data));
  }

  async _handshake() {
    this._emitStatus('handshake');
    this._responseBuffer = [];
    await this._sendCommand(SeabirdPrinter.CMD_HANDSHAKE);
    try {
      const resp = await this._waitForResponse(3000);
      if (resp[5] === SeabirdPrinter.CMD_HANDSHAKE_RESP) {
        this._emitStatus('connected', this.device.name);
        return true;
      }
    } catch {
      console.warn('Handshake timeout – continuing anyway');
    }
    return false;
  }

  async _queryPaper() {
    this._responseBuffer = [];
    await this._sendCommand(SeabirdPrinter.CMD_QUERY_PAPER);
    try {
      const resp = await this._waitForResponse(3000);
      if (resp[5] === SeabirdPrinter.CMD_QUERY_PAPER_RESP && resp.length >= 11) {
        this.paperInfo = {
          status: resp[6], // 0=no paper box, 1=ready
          width: resp[7] | (resp[8] << 8), // paper width in pixels
          stripe: resp[9] | (resp[10] << 8)
        };
        if (this.paperInfo.width > 0) {
          this._emitStatus('connected', `${this.device.name} (${this.paperInfo.width}px)`);
        }
        return this.paperInfo;
      }
    } catch {
      console.warn('Paper query timeout');
    }
    this.paperInfo = { status: 1, width: SeabirdPrinter.DEFAULT_PAPER_WIDTH, stripe: 0 };
    return this.paperInfo;
  }

  getPaperWidth() {
    return (this.paperInfo && this.paperInfo.width > 0)
      ? this.paperInfo.width
      : SeabirdPrinter.DEFAULT_PAPER_WIDTH;
  }

  // ── Print ────────────────────────────────────────────────
  async print(canvas, copies = 1, onProgress) {
    if (!this.connected || !this.characteristic) {
      throw new Error('Printer not connected');
    }

    copies = Math.max(1, Math.min(99, copies));
    const paperWidth = this.getPaperWidth();

    // Step 1: Rotate canvas 90° CW and encode bitmap
    onProgress && onProgress('encode', 0);
    const { rotatedWidth, rotatedHeight, bitmap } = this._encodeCanvas(canvas, paperWidth);

    // Step 2: Build print packet
    const packet = this._buildPrintPacket(rotatedWidth, rotatedHeight, bitmap, copies);

    // Step 3: Send data in chunks
    onProgress && onProgress('send', 0);
    const totalChunks = Math.ceil(packet.length / SeabirdPrinter.CHUNK_SIZE);

    for (let i = 0; i < packet.length; i += SeabirdPrinter.CHUNK_SIZE) {
      const chunk = packet.slice(i, Math.min(i + SeabirdPrinter.CHUNK_SIZE, packet.length));
      await this.characteristic.writeValueWithoutResponse(chunk);
      await this._delay(SeabirdPrinter.CHUNK_DELAY);

      const chunkIdx = Math.floor(i / SeabirdPrinter.CHUNK_SIZE) + 1;
      onProgress && onProgress('send', chunkIdx / totalChunks);
    }

    // Step 4: Wait for print response
    onProgress && onProgress('print', 1);
    try {
      const resp = await this._waitForResponse(30000);
      if (resp[5] === SeabirdPrinter.CMD_PRINT_RESP) {
        const result = resp[6];
        if (result === 1) return { success: true, message: 'Print successful' };
        if (result === 4) return { success: false, message: 'No paper cassette' };
        if (result === 5) return { success: false, message: 'No paper / paper jam' };
        return { success: false, message: `Print error (code ${result})` };
      }
    } catch {
      // Many printer versions don't send a response
      return { success: true, message: 'Data sent' };
    }
    return { success: true, message: 'Data sent' };
  }

  // ── Bitmap Encoding (from APK: CzzBlue.js zzDocToData_make_real) ──
  _encodeCanvas(sourceCanvas, paperWidth) {
    // Source: user's label (wide × short, e.g., 300×96)
    // We rotate 90° CW: rotated is (paperWidth × labelLength)
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    const srcCtx = sourceCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

    // Create rotated canvas
    const rotW = srcH;  // paper width (e.g., 96)
    const rotH = srcW;  // label length
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    const rotCtx = rotCanvas.getContext('2d');
    const rotImgData = rotCtx.getImageData(0, 0, rotW, rotH);
    const rotData = rotImgData.data;

    // Rotate 90° CW: rotated(x,y) = source(srcW - y - 1, x)
    for (let x = 0; x < rotW; x++) {
      for (let y = 0; y < rotH; y++) {
        const ri = (y * rotW + x) * 4;
        const sx = srcW - y - 1;
        const sy = x;
        const si = (sy * srcW + sx) * 4;
        rotData[ri] = srcData[si];
        rotData[ri + 1] = srcData[si + 1];
        rotData[ri + 2] = srcData[si + 2];
        rotData[ri + 3] = srcData[si + 3];
      }
    }

    // Encode to 1-bit monochrome bitmap (column by column, bottom to top)
    // From APK: "黑色对齐" – white=1, black=0
    const bitmap = [];
    for (let x = 0; x < rotW; x++) {
      let cell = 0;
      let cellIdx = 128;
      for (let y = rotH - 1; y >= 0; y--) {
        const pos = (y * rotW + x) * 4;
        const r = rotData[pos], g = rotData[pos + 1], b = rotData[pos + 2];
        const gray = (r + g + b) / 3;
        const isWhite = gray >= 128 ? 1 : 0;
        if (isWhite) cell |= cellIdx;
        cellIdx >>= 1;
        if (!cellIdx) {
          bitmap.push(cell);
          cell = 0;
          cellIdx = 128;
        }
      }
      if (cellIdx !== 128) bitmap.push(cell);
    }

    return { rotatedWidth: rotW, rotatedHeight: rotH, bitmap };
  }

  _buildPrintPacket(width, height, bitmap, copies) {
    const h = [];

    // Message header
    h.push(SeabirdPrinter.HEADER); // 0xA3

    // Length (4 bytes LE) – everything after this
    const payloadLen = 1 + 4 + 1 + 1 + 2 + 2 + 1 + 1 + 4 + bitmap.length;
    h.push(payloadLen & 0xFF);
    h.push((payloadLen >> 8) & 0xFF);
    h.push((payloadLen >> 16) & 0xFF);
    h.push((payloadLen >> 24) & 0xFF);

    h.push(0x25); // Command: Print

    // Checksum placeholder (4 bytes, filled later)
    h.push(0, 0, 0, 0);

    h.push(copies);      // Number of copies
    h.push(0);           // Flags (no cutter line)

    // "Width" in protocol = label feed length (rotatedHeight)
    h.push(height & 0xFF);
    h.push((height >> 8) & 0xFF);

    // "Height" in protocol = paper head width (rotatedWidth, e.g. 96)
    h.push(width & 0xFF);
    h.push((width >> 8) & 0xFF);

    h.push(1);  // Bit depth: 1 = 1-bit mono
    h.push(0);  // Reserved

    // Bitmap data length (4 bytes LE)
    h.push(bitmap.length & 0xFF);
    h.push((bitmap.length >> 8) & 0xFF);
    h.push((bitmap.length >> 16) & 0xFF);
    h.push((bitmap.length >> 24) & 0xFF);

    // Combine header + bitmap
    const packet = h.concat(bitmap);

    // Fill checksum: XOR every 4 bytes from offset 10, write at offset 6
    this._fillChecksum(packet, 10, packet.length - 10, 6);

    return new Uint8Array(packet);
  }

  _fillChecksum(bs, pb, plen, checksumpb) {
    let x = 0;
    for (let i = pb; i < pb + plen; i++) {
      bs[checksumpb + x] ^= bs[i];
      x++;
      if (x >= 4) x = 0;
    }
  }

  // ── Low-level BLE write ──────────────────────────────────
  async _writeChunked(data) {
    for (let i = 0; i < data.length; i += SeabirdPrinter.CHUNK_SIZE) {
      const chunk = data.slice(i, Math.min(i + SeabirdPrinter.CHUNK_SIZE, data.length));
      await this.characteristic.writeValueWithoutResponse(chunk);
      if (i + SeabirdPrinter.CHUNK_SIZE < data.length) {
        await this._delay(SeabirdPrinter.CHUNK_DELAY);
      }
    }
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
