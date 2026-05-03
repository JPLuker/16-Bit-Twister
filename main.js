// --- SUPER GUARD: block browser's default file-open/download on drop anywhere ---
(function superGuardDnD(){
  const cancel = (e) => {
    const dt = e.dataTransfer;
    const isFile = dt && (dt.files?.length || (dt.types && [...dt.types].includes('Files')));
    if (isFile) {
      e.preventDefault();
      try { dt.dropEffect = 'copy'; } catch {}
    }
  };
  ['dragenter','dragover','dragleave','drop'].forEach(type => {
    window.addEventListener(type, cancel,   { capture: true, passive: false });
    document.addEventListener(type, cancel, { capture: true, passive: false });
  });
})();

// ===== 8-Bit Twister (core logic) =====

const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- Fixed timestep for 60Hz emulation ---
const FRAME_MS = 1000 / 60;
let t1Last = 0, t1Acc = 0;
let t2Last = 0, t2Acc = 0;

// Key pool (KeyboardEvent.code)
const KEY_CODES = [
  'KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP',
  'KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL',
  'KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM',
  'Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0',
  'Semicolon','Comma','Period','Slash','Backslash','Minus','Equal'
];
const CODE_LABEL = { Semicolon:';', Comma:',', Period:'.', Slash:'/', Backslash:'\\', Minus:'-', Equal:'=' };
const labelFor = code =>
  CODE_LABEL[code] || (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code);

// ---- System definitions ----
// Each entry: name, file extensions, and ordered button list [label, id]
// Button ids are arbitrary per-adapter integers — each adapter defines its own mapping.
const SYSTEMS = {
  nes: {
    name: 'NES',
    extensions: ['.nes'],
    buttons: [
      ['UP', 0], ['DOWN', 1], ['LEFT', 2], ['RIGHT', 3],
      ['A', 4], ['B', 5], ['START', 6], ['SELECT', 7],
    ],
  },
  gb: {
    name: 'Game Boy',
    extensions: ['.gb', '.gbc'],
    // JoyPadEvent key indices: 0=Right 1=Left 2=Up 3=Down 4=A 5=B 6=Select 7=Start
    buttons: [
      ['UP', 2], ['DOWN', 3], ['LEFT', 1], ['RIGHT', 0],
      ['A', 4], ['B', 5], ['START', 7], ['SELECT', 6],
    ],
  },
};

const ALL_EXTENSIONS = Object.values(SYSTEMS).flatMap(s => s.extensions);

function detectSystem(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  for (const [key, sys] of Object.entries(SYSTEMS)) {
    if (sys.extensions.includes(ext)) return key;
  }
  return null;
}

// ============================================================
// Emulator Adapters
// Each adapter must implement:
//   loadROM(bytes: Uint8Array)
//   frame()
//   buttonDown(btn: number)
//   buttonUp(btn: number)
// ============================================================

// ---- NES (JSNES) ----
class NesAdapter {
  constructor(canvas, audioInput) {
    if (!window.jsnes) throw new Error('JSNES library not loaded.');
    canvas.width = 256; canvas.height = 240;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(256, 240);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 240);

    this._nes = new jsnes.NES({
      onFrame: frame => {
        for (let i = 0; i < 256 * 240; i++) {
          const j = i * 4, c = frame[i];
          imageData.data[j  ] =  c & 0xFF;
          imageData.data[j+1] = (c >>  8) & 0xFF;
          imageData.data[j+2] = (c >> 16) & 0xFF;
          imageData.data[j+3] = 0xFF;
        }
        ctx.putImageData(imageData, 0, 0);
      },
      onAudioSample: (l, r) => {
        if (!audioInput) return;
        audioInput.left.push(l);
        audioInput.right.push(r);
      },
    });
  }

  loadROM(bytes) {
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    this._nes.loadROM(s);
  }

  frame()         { this._nes.frame(); }
  buttonDown(btn) { this._nes.buttonDown(1, btn); }
  buttonUp(btn)   { this._nes.buttonUp(1, btn); }
}

// ---- Dynamic library loader ----
// Loads CommonJS-style libraries via fetch+eval (avoids needing a bundler).
// Each entry: { url, module } — module is populated after load().
const LIBS = {
  gb: { url: 'https://unpkg.com/gameboy@0.2.0/index.js', module: null, _promise: null },
};

// Minimal browser-side require() for the deps the gameboy package needs.
function makeBrowserRequire() {
  // component/emitter-compatible mixin
  function Emitter(obj) {
    if (obj) { for (const k in Emitter.prototype) obj[k] = Emitter.prototype[k]; return obj; }
  }
  Emitter.prototype.on = function(ev, fn) {
    this._ev = this._ev || {};
    (this._ev[ev] = this._ev[ev] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function(ev, fn) {
    if (this._ev && this._ev[ev]) this._ev[ev] = this._ev[ev].filter(f => f !== fn);
    return this;
  };
  Emitter.prototype.emit = function(ev, ...args) {
    if (this._ev && this._ev[ev]) [...this._ev[ev]].forEach(f => f.apply(this, args));
    return this;
  };
  Emitter.prototype.once = function(ev, fn) {
    const wrap = (...a) => { this.off(ev, wrap); fn.apply(this, a); };
    return this.on(ev, wrap);
  };

  return function require(name) {
    if (name === 'emitter') return Emitter;
    if (name === 'debug')   return () => () => {};  // no-op logger
    throw new Error(`Browser require: '${name}' is not bundled`);
  };
}

async function loadLib(key) {
  const lib = LIBS[key];
  if (!lib || lib.module) return;
  if (!lib._promise) {
    lib._promise = fetch(lib.url)
      .then(r => { if (!r.ok) throw new Error(`Failed to fetch ${lib.url}`); return r.text(); })
      .then(code => {
        const mod = { exports: {} };
        new Function('module', 'exports', 'require', code)(mod, mod.exports, makeBrowserRequire());
        lib.module = mod.exports;
      });
  }
  await lib._promise;
}

// Maps system key → library key (undefined = no external lib needed)
const SYSTEM_LIB = { gb: 'gb' };

// ---- Game Boy / GBC (gameboy@0.2.0 by grantgalitz) ----
// Wraps a XAudioJS-style constructor to route samples into our RingBuffer mixer.
function makeSoundCtor(audioInput) {
  function SoundCtor() { this._ai = audioInput; }
  SoundCtor.prototype.writeAudioNoCallback = function(buf) {
    if (!this._ai) return;
    for (let i = 0; i < buf.length; i += 2) {
      this._ai.left.push(buf[i]);
      this._ai.right.push(buf[i + 1]);
    }
  };
  SoundCtor.prototype.remainingBuffer = function() { return 0; };
  SoundCtor.prototype.changeVolume    = function() {};
  return SoundCtor;
}

class GbAdapter {
  constructor(canvas, audioInput) {
    const GBC = LIBS.gb.module;
    if (!GBC) throw new Error('Game Boy library not loaded — try dropping the ROM again.');
    canvas.width = 160; canvas.height = 144;
    this._gb = new GBC(canvas, null, {
      sound:  audioInput ? makeSoundCtor(audioInput) : null,
      volume: 1,
      drawEvents: false,
    });
  }

  loadROM(bytes) {
    this._gb.ROMImage = bytes;
    this._gb.start();
    // start() internally calls run(), but stopEmulator initialises to 3 (bit 1 set = "externally
    // stopped"), so run() is a no-op. Set to 1 (bit 0 = "frame done, ready") so our rAF loop can
    // drive frames correctly.
    this._gb.stopEmulator = 1;
  }

  frame()         { this._gb.run(); }
  buttonDown(btn) { this._gb.JoyPadEvent(btn, true); }
  buttonUp(btn)   { this._gb.JoyPadEvent(btn, false); }
}

function createAdapter(systemKey, canvas, audioInput) {
  switch (systemKey) {
    case 'nes': return new NesAdapter(canvas, audioInput);
    case 'gb':  return new GbAdapter(canvas, audioInput);
    default: throw new Error(`Unknown system: "${systemKey}"`);
  }
}

// ---- State ----
let emu1 = null, emu2 = null;
let chan1 = null, chan2 = null;  // audio channels, set in init()
let currentSystem = null;
let loopId1 = null, loopId2 = null;
let running = false;
let gameBytes = null;
let endAt = 0;
let timerId = null;
let resultsShown = false;
const keymapP1 = new Map(); // code -> btn id
const keymapP2 = new Map();

// ---- Audio: single mixer with ring buffers (fast, stable) ----
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }
  }
  return audioCtx;
}

// O(1) FIFO ring buffer for audio samples
class RingBuffer {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.capacity = capacity;
    this.read = 0; this.write = 0; this.size = 0;
  }
  push(x) {
    if (this.size < this.capacity) {
      this.buf[this.write] = x;
      this.write = (this.write + 1) % this.capacity;
      this.size++;
    } else {
      this.buf[this.write] = x;
      this.write = (this.write + 1) % this.capacity;
      this.read = (this.read + 1) % this.capacity;
    }
  }
  shift() {
    if (this.size === 0) return 0;
    const x = this.buf[this.read];
    this.read = (this.read + 1) % this.capacity;
    this.size--;
    return x;
  }
}

class Mixer {
  constructor(ctx, bufferSize = 2048) {
    this.ctx = ctx;
    this.inputs = [];
    this.node = ctx.createScriptProcessor(bufferSize, 0, 2);
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    this.node.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0);
      const R = e.outputBuffer.getChannelData(1);
      const n = L.length;
      for (let i = 0; i < n; i++) {
        let outL = 0, outR = 0;
        for (const ch of this.inputs) {
          if (ch.muted) continue;
          const sl = ch.left.shift();
          const sr = ch.right.shift();
          const mono = 0.5 * (sl + sr) * ch.gain;
          const angle = (ch.pan + 1) * (Math.PI / 4);
          outL += mono * Math.cos(angle);
          outR += mono * Math.sin(angle);
        }
        L[i] = Math.max(-1, Math.min(1, outL));
        R[i] = Math.max(-1, Math.min(1, outR));
      }
    };

    this.node.connect(this.master);
    this.master.connect(ctx.destination);
  }

  createInput(initialGain = 0.5, pan = 0) {
    const cap = Math.max(16384, (this.ctx.sampleRate * 2) | 0);
    const ch = {
      left: new RingBuffer(cap), right: new RingBuffer(cap),
      gain: initialGain, muted: false, pan,
    };
    this.inputs.push(ch);
    return ch;
  }
}

// ---- Emulation loops ----
function startLoops() {
  if (!loopId1) {
    const step1 = (now) => {
      if (!running) { loopId1 = null; return; }
      if (!t1Last) t1Last = now;
      t1Acc += now - t1Last; t1Last = now;
      let steps = 0;
      while (t1Acc >= FRAME_MS && steps < 3) { emu1.frame(); t1Acc -= FRAME_MS; steps++; }
      loopId1 = requestAnimationFrame(step1);
    };
    loopId1 = requestAnimationFrame(step1);
  }
  if (!loopId2) {
    const step2 = (now) => {
      if (!running) { loopId2 = null; return; }
      if (!t2Last) t2Last = now;
      t2Acc += now - t2Last; t2Last = now;
      let steps = 0;
      while (t2Acc >= FRAME_MS && steps < 3) { emu2.frame(); t2Acc -= FRAME_MS; steps++; }
      loopId2 = requestAnimationFrame(step2);
    };
    loopId2 = requestAnimationFrame(step2);
  }
}

function stopLoops() {
  if (loopId1) { cancelAnimationFrame(loopId1); loopId1 = null; }
  if (loopId2) { cancelAnimationFrame(loopId2); loopId2 = null; }
  t1Last = t1Acc = 0;
  t2Last = t2Acc = 0;
}

// ---- Key randomization + legend ----
function pickUnique(pool, count, taken = new Set()) {
  const avail = pool.filter(c => !taken.has(c));
  for (let i = avail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [avail[i], avail[j]] = [avail[j], avail[i]];
  }
  return avail.slice(0, count);
}

function randomizeKeybinds() {
  keymapP1.clear(); keymapP2.clear();
  const buttons = currentSystem ? SYSTEMS[currentSystem].buttons : SYSTEMS.nes.buttons;
  const count = buttons.length;
  const used = new Set();
  const p1 = pickUnique(KEY_CODES, count, used); p1.forEach(c => used.add(c));
  const p2 = pickUnique(KEY_CODES, count, used);

  buttons.forEach(([, btn], i) => keymapP1.set(p1[i], btn));
  buttons.forEach(([, btn], i) => keymapP2.set(p2[i], btn));

  const renderTable = (codes, el) => {
    let html = '<table>';
    buttons.forEach(([label], i) => { html += `<tr><td>${label}</td><td><b>${labelFor(codes[i])}</b></td></tr>`; });
    html += '</table>';
    el.innerHTML = html;
  };
  renderTable(p1, $('#keys1'));
  renderTable(p2, $('#keys2'));
}

// ---- Keyboard → emulator ----
function handleKey(e, down) {
  if (!emu1 || !emu2) return;
  const code = e.code;
  let handled = false;

  if (keymapP1.has(code)) {
    const btn = keymapP1.get(code);
    down ? emu1.buttonDown(btn) : emu1.buttonUp(btn);
    handled = true;
  }
  if (keymapP2.has(code)) {
    const btn = keymapP2.get(code);
    down ? emu2.buttonDown(btn) : emu2.buttonUp(btn);
    handled = true;
  }
  if (handled) e.preventDefault();
}
addEventListener('keydown', e => running && handleKey(e, true));
addEventListener('keyup',   e => running && handleKey(e, false));

// ---- ROM loading ----
async function loadRomFromFile(file) {
  const systemKey = detectSystem(file.name);
  if (!systemKey) {
    alert(`Unrecognized file type.\n\nSupported extensions: ${ALL_EXTENSIONS.join(', ')}`);
    return;
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Pre-load any external library this system needs
  const libKey = SYSTEM_LIB[systemKey];
  if (libKey) {
    try { await loadLib(libKey); }
    catch (err) { alert(`Failed to load ${SYSTEMS[systemKey].name} library.\n${err.message}`); return; }
  }

  try {
    emu1 = createAdapter(systemKey, $('#screen1'), chan1);
    emu2 = createAdapter(systemKey, $('#screen2'), chan2);
    emu1.loadROM(bytes);
    emu2.loadROM(bytes);
  } catch (err) {
    console.error('ROM load failed:', err);
    alert(err.message);
    emu1 = null; emu2 = null;
    return;
  }

  currentSystem = systemKey;
  gameBytes = bytes;

  emu1.frame(); emu2.frame();
  randomizeKeybinds();

  // Update system badge in header
  const badge = $('#system-badge');
  if (badge) badge.textContent = SYSTEMS[systemKey].name;

  const dur = parseInt($('#duration').value, 10);
  $('#timer').textContent = fmt(dur);
  console.log(`ROM ready (${SYSTEMS[systemKey].name}). Review keys, then click "Start Match".`);
}

// ---- Drag-and-drop ----
function setupDnD() {
  const dz = document.querySelector('.dropzone');
  if (!dz) return;

  const onOver = (e) => {
    e.preventDefault();
    dz.classList.add('dragging');
    try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch {}
  };
  const onLeave = (e) => { e.preventDefault(); dz.classList.remove('dragging'); };

  dz.addEventListener('dragenter', onOver);
  dz.addEventListener('dragover',  onOver);
  dz.addEventListener('dragleave', onLeave);

  const handleDrop = async (e, fromZone) => {
    e.preventDefault();
    if (fromZone) dz.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ctx = getAudioCtx();
    if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
    await loadRomFromFile(file);
  };

  dz.addEventListener('drop', e => handleDrop(e, true));
  window.addEventListener('drop', e => handleDrop(e, false), { passive: false });
}

function setupChooserFallback() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ALL_EXTENSIONS.join(',');
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async () => {
    if (input.files[0]) {
      const ctx = getAudioCtx();
      if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
      await loadRomFromFile(input.files[0]);
      input.value = '';
    }
  });

  const dz = document.querySelector('.dropzone');
  if (dz) {
    dz.style.cursor = 'pointer';
    dz.title = 'Click to choose a ROM file';
    dz.addEventListener('click', () => input.click());
  }
}

// ---- Timer / results modal ----
function fmt(s) {
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function startTimer(seconds) {
  endAt = Date.now() + seconds * 1000;
  $('#timer').textContent = fmt(seconds);
  if (timerId) { clearInterval(timerId); timerId = null; }
  resultsShown = false;

  timerId = setInterval(() => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    $('#timer').textContent = fmt(left);
    if (left <= 0) {
      clearInterval(timerId); timerId = null;
      if (!resultsShown) { stopMatch(); showResults(); resultsShown = true; }
    }
  }, 200);
}

function showResults() { $('#results').classList.add('show'); }
function hideResults()  { $('#results').classList.remove('show'); }

const PRESTART_SEC = 10;

async function preStartCountdown(seconds = PRESTART_SEC) {
  if (!seconds) return;
  const startBtn = $('#start');
  const timerEl  = $('#timer');
  if (startBtn) startBtn.disabled = true;
  for (let i = seconds; i > 0; i--) {
    if (timerEl) timerEl.textContent = `Start in ${i}…`;
    await sleep(1000);
  }
  if (startBtn) startBtn.disabled = false;
  const dur = parseInt($('#duration').value, 10);
  if (timerEl) timerEl.textContent = fmt(dur);
}

// ---- Match controls ----
async function startMatch() {
  if (!gameBytes) { alert('Drop a ROM file first.'); return; }
  const ctx = getAudioCtx();
  if (ctx && ctx.state !== 'running') { ctx.resume(); }
  if (!running) {
    await preStartCountdown();
    running = true;
    startLoops();
    startTimer(parseInt($('#duration').value, 10));
  }
}

function stopMatch() {
  running = false;
  stopLoops();
  if (timerId) { clearInterval(timerId); timerId = null; }
}

function sliderToGain(el) {
  const min = parseFloat(el.min || '0');
  const max = parseFloat(el.max || '1');
  const val = parseFloat(el.value || String(min));
  if (max === min) return 0;
  return (val - min) / (max - min);
}

function setSliderFromGain(el, gain) {
  const min = parseFloat(el.min || '0');
  const max = parseFloat(el.max || '1');
  el.value = String(min + Math.max(0, Math.min(1, gain)) * (max - min));
}

// ---- Bootstrap ----
function init() {
  setupChooserFallback();
  setupDnD();

  const ctx = getAudioCtx();
  const mixer = new Mixer(ctx, 2048);
  chan1 = mixer.createInput(0.5, -1); // P1 -> hard left
  chan2 = mixer.createInput(0.5, +1); // P2 -> hard right

  const vol1 = document.getElementById('vol1');
  const vol2 = document.getElementById('vol2');

  if (vol1) {
    setSliderFromGain(vol1, chan1.gain);
    const u = () => { chan1.gain = sliderToGain(vol1); };
    vol1.addEventListener('input', u); vol1.addEventListener('change', u);
  }
  if (vol2) {
    setSliderFromGain(vol2, chan2.gain);
    const u = () => { chan2.gain = sliderToGain(vol2); };
    vol2.addEventListener('input', u); vol2.addEventListener('change', u);
  }

  // Show default key table (NES layout) before any ROM is loaded
  randomizeKeybinds();

  $('#randomize').onclick = () => randomizeKeybinds();
  $('#start').onclick     = () => startMatch();
  $('#stop').onclick      = () => stopMatch();
  $('#newRound').onclick  = async () => { hideResults(); randomizeKeybinds(); await sleep(50); startMatch(); };
  $('#close').onclick     = () => hideResults();
}

document.addEventListener('DOMContentLoaded', init);
