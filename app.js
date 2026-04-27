/**
 * Label Editor – UI logic for the Seabird Label Printer Web App
 */

const printer = new SeabirdPrinter();

// ── DOM References ─────────────────────────────────────────
const dom = {
  connectBtn: document.getElementById('connect-btn'),
  disconnectBtn: document.getElementById('disconnect-btn'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),

  textInput: document.getElementById('label-text'),
  fontSelect: document.getElementById('font-select'),
  fontSize: document.getElementById('font-size'),
  fontSizeVal: document.getElementById('font-size-val'),
  boldToggle: document.getElementById('bold-toggle'),
  alignBtns: document.querySelectorAll('.align-btn'),
  paddingInput: document.getElementById('label-padding'),

  canvas: document.getElementById('label-canvas'),
  previewWrap: document.getElementById('preview-wrap'),

  copies: document.getElementById('copies'),
  printBtn: document.getElementById('print-btn'),
  printStatus: document.getElementById('print-status'),
  progressBar: document.getElementById('progress-bar'),
  progressFill: document.getElementById('progress-fill'),
};

// ── State ──────────────────────────────────────────────────
let currentAlign = 'center';
let paperWidth = 96; // will be updated after connection

// ── Printer Status ─────────────────────────────────────────
printer.onStatusChange = (status, detail) => {
  dom.statusDot.className = 'status-dot ' + status;
  const labels = {
    disconnected: 'Not connected',
    connecting: 'Connecting...',
    handshake: 'Handshake...',
    connected: `Connected: ${detail || ''}`,
  };
  dom.statusText.textContent = labels[status] || status;

  const isConnected = status === 'connected';
  dom.connectBtn.classList.toggle('hidden', isConnected);
  dom.disconnectBtn.classList.toggle('hidden', !isConnected);
  dom.printBtn.disabled = !isConnected;

  if (isConnected) {
    paperWidth = printer.getPaperWidth();
    renderLabel();
  }
};

// ── Connection ─────────────────────────────────────────────
dom.connectBtn.addEventListener('click', async () => {
  try {
    dom.connectBtn.disabled = true;
    await printer.connect();
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      showPrintStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    dom.connectBtn.disabled = false;
  }
});

dom.disconnectBtn.addEventListener('click', () => printer.disconnect());

// ── Label Rendering ────────────────────────────────────────
function renderLabel() {
  const canvas = dom.canvas;
  const ctx = canvas.getContext('2d');

  const text = dom.textInput.value || ' ';
  const fontFamily = dom.fontSelect.value;
  const size = parseInt(dom.fontSize.value);
  const bold = dom.boldToggle.classList.contains('active');
  const padding = parseInt(dom.paddingInput.value) || 8;
  const pw = paperWidth || 96;

  // Build font string
  const fontStr = `${bold ? 'bold ' : ''}${size}px "${fontFamily}", sans-serif`;

  // Measure text to determine canvas width
  ctx.font = fontStr;
  const lines = text.split('\n');
  const lineHeight = size * 1.25;

  let maxLineWidth = 0;
  lines.forEach(line => {
    const m = ctx.measureText(line || ' ');
    if (m.width > maxLineWidth) maxLineWidth = m.width;
  });

  // Canvas dimensions
  const labelWidth = Math.max(Math.ceil(maxLineWidth) + padding * 2, pw);
  canvas.width = labelWidth;
  canvas.height = pw;

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw text
  ctx.fillStyle = '#000000';
  ctx.font = fontStr;
  ctx.textBaseline = 'middle';

  const totalTextHeight = lines.length * lineHeight;
  const startY = (pw - totalTextHeight) / 2 + lineHeight / 2;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    let x;
    if (currentAlign === 'left') {
      ctx.textAlign = 'left';
      x = padding;
    } else if (currentAlign === 'right') {
      ctx.textAlign = 'right';
      x = canvas.width - padding;
    } else {
      ctx.textAlign = 'center';
      x = canvas.width / 2;
    }
    ctx.fillText(line, x, y);
  });

  updatePreviewSize();
}

function updatePreviewSize() {
  const canvas = dom.canvas;
  const zoom = Math.max(2, Math.floor(240 / (paperWidth || 96)));
  canvas.style.height = (canvas.height * zoom) + 'px';
  canvas.style.width = (canvas.width * zoom) + 'px';
}

// ── Event Listeners ────────────────────────────────────────
dom.textInput.addEventListener('input', renderLabel);
dom.fontSelect.addEventListener('change', renderLabel);
dom.fontSize.addEventListener('input', () => {
  dom.fontSizeVal.textContent = dom.fontSize.value + 'px';
  renderLabel();
});
dom.paddingInput.addEventListener('input', renderLabel);

dom.boldToggle.addEventListener('click', () => {
  dom.boldToggle.classList.toggle('active');
  renderLabel();
});

dom.alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    dom.alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentAlign = btn.dataset.align;
    renderLabel();
  });
});

// ── Print ──────────────────────────────────────────────────
dom.printBtn.addEventListener('click', async () => {
  if (!printer.connected) return;

  const copies = parseInt(dom.copies.value) || 1;
  const flipX = document.getElementById('flip-x') ? document.getElementById('flip-x').checked : false;
  const flipY = document.getElementById('flip-y') ? document.getElementById('flip-y').checked : false;
  
  dom.printBtn.disabled = true;
  dom.progressBar.classList.remove('hidden');
  dom.progressFill.style.width = '0%';
  showPrintStatus('Preparing print...', 'info');

  try {
    const result = await printer.print(dom.canvas, copies, flipX, flipY, (phase, progress) => {
      const pct = Math.round(progress * 100);
      dom.progressFill.style.width = pct + '%';
      if (phase === 'encode') showPrintStatus('Converting image...', 'info');
      else if (phase === 'send') showPrintStatus(`Sending data... ${pct}%`, 'info');
      else if (phase === 'print') showPrintStatus('Printing...', 'info');
    });

    dom.progressFill.style.width = '100%';
    showPrintStatus(result.message, result.success ? 'success' : 'error');
  } catch (err) {
    showPrintStatus(`Error: ${err.message}`, 'error');
  } finally {
    dom.printBtn.disabled = false;
    setTimeout(() => dom.progressBar.classList.add('hidden'), 3000);
  }
});

function showPrintStatus(msg, type = 'info') {
  dom.printStatus.textContent = msg;
  dom.printStatus.className = 'print-status ' + type;
  dom.printStatus.classList.remove('hidden');
}

// ── Init ───────────────────────────────────────────────────
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => renderLabel());
} else {
  window.addEventListener('load', () => renderLabel());
}
