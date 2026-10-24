/* =========================================================
   JGVRP Speedometer HUD  (layout pill, bar RPM segmented)

   API global (dipanggil dari game / CEF) - semua nama lama dipertahankan:
     setSpeed(m/s)            setRPM(0.0 - 1.0)
     setFuel(0-1 | 0-100)     setHealth(0-1 | 0-1000)
     setGear(n)               setHeadlights(0 off | 1 low | 2 high)
     setSeatbelts(bool)       setEngine(bool)
     setOdometer(jarak)       updateLockStatus(state) (+ alias lama)
     setLeftIndicator / setRightIndicator  (no-op, sein tidak ada di desain)
     playIntro()

   API baru (netral, tidak terikat framework apa pun):
     setTemp(derajat C)       setCheckEngine(bool)
     setOilWarning(bool)      setBatteryWarning(bool)
     setTrip(km)              resetTrip()
     setTheme(nama|angka)     nextTheme()

   Pesan NUI: window.postMessage({ action: 'setSpeed', speed: 12.3 })
   (nama action = nama fungsi di atas; daftar lengkap ada di tabel ACTIONS)

   Mode: GAME (default, tanpa data palsu) atau DEMO (?demo -> data simulasi).
   ========================================================= */
'use strict';

// ---------- Konfigurasi (ubah di sini) ----------
const CONFIG = {
    maxRpm: 9,              // skala tachometer (x1000), sesuai angka 0-9 di desain
    redline: 8,             // zona merah mulai di sini (x1000)
    rpmSegments: 80,        // jumlah segmen bar RPM
    gaugeSegments: 14,      // jumlah segmen bar fuel / temp
    speedFactor: 3.6,       // m/s -> km/h
    odoInputUnit: 'mi',     // satuan yang DIKIRIM game ke setOdometer: 'mi' atau 'km' (tampilan selalu KM)
    tempMinC: 50,           // suhu di ujung "C"
    tempMaxC: 130,          // suhu di ujung "H"
    tempHotC: 105,          // di atas ini 4 segmen terakhir jadi merah
    fuelLow: 0.20,          // bensin di bawah ini -> bar kuning
    maxFps: 60,
};

const MI_TO_KM = 1.609344;

const NOOP_EL = document.createElement('div');   // pengaman kalau ada elemen yang sudah dihapus dari HTML
const $ = (id) => document.getElementById(id) || NOOP_EL;
const elHud = $('hud');

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Helper parser (JGRP) ----------
function isLockedState(val) {
    return val === true || val === 1 || val === '1' || val === 'true' || val === 2 || val === '2';
}
function isTrueValue(val) {
    return val === true || val === 1 || val === '1' || val === 'true';
}

// Tulis DOM hanya kalau isinya memang berubah (hindari repaint sia-sia)
function setText(el, txt) { txt = String(txt); if (el.textContent !== txt) el.textContent = txt; }
function setClass(el, cls) { if (el.className !== cls) el.className = cls; }

// ---------- Warna ----------
const WHITE = [255, 255, 255];
const rgbStr = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function gradient(stops, t) {
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
            return mixRgb(c0, c1, (t - t0) / (t1 - t0 || 1));
        }
    }
    return stops[stops.length - 1][1];
}
const rpmStops = (a, l) => [
    [0, mixRgb([0, 0, 0], a, 0.6)], [0.14, a], [0.28, l], [0.38, WHITE], [0.52, [238, 238, 238]],
    [0.64, [190, 190, 190]], [0.77, [125, 125, 125]], [0.80, [200, 82, 28]], [0.88, [255, 79, 20]], [1, [255, 30, 26]],
];
const fuelStops = (a) => [[0, a], [0.45, a], [0.65, WHITE], [1, WHITE]];
const tempStops = (a) => [[0, a], [0.5, a], [0.65, WHITE], [0.78, WHITE], [0.86, [255, 106, 26]], [1, [255, 34, 26]]];

// ---------- Bar RPM (SVG) ----------
// Koordinat dalam viewBox 930 x 76. Angka 0 di x=78, angka 9 di x=815 (sesuai desain referensi).
const RPM = { x0: 45, x1: 824, xv0: 78, xv9: 815, bottom: 66, n: CONFIG.rpmSegments };
RPM.pitch = (RPM.x1 - RPM.x0) / RPM.n;
RPM.c0 = RPM.x0 + RPM.pitch / 2;
let rpmSegs = [];

function buildRpm() {
    const svg = $('rpm');
    const segW = RPM.pitch * 0.64, slant = 3;
    let s = `
    <polygon class="frame-fill" points="36,1 894,1 929,38 894,75 36,75 1,38"/>
    <polygon class="frame-line" points="36,1 894,1 929,38 894,75 36,75 1,38"/>
    <polyline class="chev" points="28,9 5,38 28,67"/>
    <polyline class="chev" points="902,9 925,38 902,67"/>`;
    for (let v = 0; v <= 9; v++) {
        const x = RPM.xv0 + (v * (RPM.xv9 - RPM.xv0)) / 9;
        const y = 27 - 12 * Math.sin((Math.PI * v) / 9);
        s += `<text class="rnum${v >= CONFIG.redline ? ' rl' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${v}</text>`;
    }
    s += '<text class="rlbl" x="850" y="32">RPM</text><text class="rsub" x="850" y="51">x1000</text>';
    let inRedGroup = false;     // segmen zona merah dibungkus <g> agar kedipnya serempak
    for (let i = 0; i < RPM.n; i++) {
        const t = i / (RPM.n - 1);
        const h = 11 + 22 * Math.sin(Math.PI * t) + 7 * t;       // tinggi segmen: melengkung seperti desain
        const cx = RPM.c0 + i * RPM.pitch, x = cx - segW / 2 - slant / 2, top = RPM.bottom - h;
        const value = ((cx - RPM.xv0) / (RPM.xv9 - RPM.xv0)) * 9;
        const red = value >= CONFIG.redline;
        if (red && !inRedGroup) { s += '<g class="rl-group">'; inRedGroup = true; }
        s += `<polygon class="rseg${red ? ' rl' : ''}" points="${(x + slant).toFixed(2)},${top.toFixed(2)} ${(x + slant + segW).toFixed(2)},${top.toFixed(2)} ${(x + segW).toFixed(2)},${RPM.bottom} ${x.toFixed(2)},${RPM.bottom}"/>`;
    }
    if (inRedGroup) s += '</g>';
    svg.innerHTML = s;
    rpmSegs = Array.from(svg.querySelectorAll('.rseg'));
}
buildRpm();

// Banyak segmen RPM yang menyala untuk ratio 0-1 (ratio 1 = angka 9)
function rpmLitCount(ratio) {
    if (ratio <= 0.004) return 0;
    const x = RPM.xv0 + ratio * (RPM.xv9 - RPM.xv0) + 5;
    return Math.max(0, Math.min(RPM.n, Math.floor((x - RPM.c0) / RPM.pitch) + 1));
}

// ---------- Bar fuel / temp ----------
const bars = {};
['fuel', 'temp'].forEach((k) => {
    const el = $('bar-' + k), mk = el.querySelector('.mk');
    const segs = [];
    for (let i = 0; i < CONFIG.gaugeSegments; i++) {
        const seg = document.createElement('i');
        el.appendChild(seg);       // penanda (.mk) tetap anak pertama, jadi urutan segmen bersih
        segs.push(seg);
    }
    bars[k] = { segs, mk, n: -1, mkPct: -1 };
});
function setBar(k, ratio) {
    const b = bars[k], r = clamp01(ratio);
    const n = Math.round(r * CONFIG.gaugeSegments);
    if (b.n !== n) {
        b.n = n;
        b.segs.forEach((el, i) => el.classList.toggle('on', i < n));
    }
    const pct = Math.round(r * 1000) / 10;
    if (b.mkPct !== pct) { b.mkPct = pct; b.mk.style.left = pct + '%'; }
}

// Warnai semua segmen sesuai warna aksen tema
function recolor(a, l) {
    const N = CONFIG.gaugeSegments;
    rpmSegs.forEach((el, i) => el.style.setProperty('--c', rgbStr(gradient(rpmStops(a, l), i / (RPM.n - 1)))));
    bars.fuel.segs.forEach((el, i) => el.style.setProperty('--c', rgbStr(gradient(fuelStops(a), i / (N - 1)))));
    bars.temp.segs.forEach((el, i) => el.style.setProperty('--c', rgbStr(gradient(tempStops(a), i / (N - 1)))));
}

// ---------- Teks intro (ganti di index.html pada data-text="..."; ukuran huruf otomatis) ----------
(function () {
    const el = $('intro-text');
    if (el === NOOP_EL) return;
    const text = (el.dataset.text || el.textContent || 'OBEY').trim().toUpperCase();
    const chars = Array.from(text);
    el.textContent = '';
    chars.forEach((ch, i) => {
        const span = document.createElement('span');
        span.textContent = ch === ' ' ? ' ' : ch;
        span.style.animationDelay = (0.3 + i * 0.09).toFixed(2) + 's';
        el.appendChild(span);
    });
    el.style.fontSize = Math.max(14, Math.min(54, Math.floor(400 / (chars.length * 0.95)))) + 'px';
})();

// ---------- State ----------
const state = {
    mps: 0,          // kecepatan mentah (m/s)
    kmh: 0,
    lastKmhShown: -1,
    rpm: 0,          // target 0-1 dari game
    rpmShown: 0,     // nilai yang di-smooth untuk animasi
    litRpm: 0,
    health: 1,       // 0-1
    fuel: 1,
    belted: false,
    engine: false,   // dari setEngine(); alarm hanya bunyi saat mesin hidup
    locked: false,
    checkEngine: false,
    oilWarn: false,
    battWarn: false,
    trip: 0,         // km
    lastSpeedAt: 0,
    lastTripSave: 0,
};
const BOOT_MS = 1700;
let bootUntil = performance.now() + BOOT_MS;

let lastRedline = null;
function renderRpm(ratio) {
    const n = rpmLitCount(ratio);
    if (n !== state.litRpm) {                         // sentuh hanya segmen yang berubah
        const lo = Math.min(n, state.litRpm), hi = Math.max(n, state.litRpm);
        for (let i = lo; i < hi; i++) rpmSegs[i].classList.toggle('on', i < n);
        state.litRpm = n;
    }
    const red = ratio >= CONFIG.redline / CONFIG.maxRpm;
    if (red !== lastRedline) {
        lastRedline = red;
        elHud.classList.toggle('redline', red);
    }
}

// ---------- Loop animasi ----------
// Hemat FPS: loop BERHENTI saat tidak ada yang bergerak, dan dibatasi maxFps.
const FRAME_MS = 1000 / CONFIG.maxFps;
let lastFrame = 0, rafId = 0;
function kick() {                         // bangunkan loop kalau sedang berhenti
    if (rafId) return;
    lastFrame = performance.now() - FRAME_MS;
    rafId = requestAnimationFrame(frame);
}
function frame(now) {
    rafId = 0;
    if (now - lastFrame < FRAME_MS - 2) { rafId = requestAnimationFrame(frame); return; }   // lewati frame (batas FPS)
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    let target = state.rpm;
    if (now < bootUntil) {
        // sweep bar saat kontak ON: 0 -> max -> 0
        const t = 1 - (bootUntil - now) / BOOT_MS;
        target = t < 0.45 ? t / 0.45 : t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
    } else if (elHud.classList.contains('booting')) {
        elHud.classList.remove('booting');
    }

    const k = now < bootUntil ? 1 : Math.min(1, dt * 14);
    state.rpmShown += (target - state.rpmShown) * k;
    if (Math.abs(target - state.rpmShown) < 0.0005) state.rpmShown = target;
    renderRpm(state.rpmShown);

    if (now < bootUntil || state.rpmShown !== target) rafId = requestAnimationFrame(frame);   // lanjut hanya kalau masih bergerak
}
kick();

// ---------- Trip A (dihitung otomatis dari kecepatan, disimpan di localStorage) ----------
try { state.trip = Math.max(0, parseFloat(localStorage.getItem('hudTrip')) || 0); } catch (e) {}
function renderTrip() { setText($('trip'), state.trip.toFixed(1)); }
function saveTrip(force) {
    const now = performance.now();
    if (!force && now - state.lastTripSave < 5000) return;
    state.lastTripSave = now;
    try { localStorage.setItem('hudTrip', state.trip.toFixed(3)); } catch (e) {}
}
window.setTrip = function (km) { state.trip = Math.max(0, Number(km) || 0); renderTrip(); saveTrip(true); };
window.resetTrip = function () { window.setTrip(0); };

// ---------- 1. Kecepatan (m/s -> KM/H) ----------
function padDigits(n, len) {
    const s = String(Math.max(0, n)).padStart(len, '0');
    const firstSig = s.search(/[1-9]/);
    const cut = firstSig === -1 ? len - 1 : firstSig;
    return `<span class="dim">${s.slice(0, cut)}</span><span class="bright">${s.slice(cut)}</span>`;
}
window.setSpeed = function (speed) {
    const mps = Math.max(0, Number(speed) || 0);
    const kmh = Math.round(mps * CONFIG.speedFactor);
    state.mps = mps;
    state.kmh = kmh;
    if (kmh !== state.lastKmhShown) {                 // ganti DOM hanya kalau angkanya berubah
        state.lastKmhShown = kmh;
        $('speed-display').innerHTML = padDigits(kmh, 3);
    }
    const now = performance.now();                    // integrasi jarak untuk Trip A
    if (state.lastSpeedAt) {
        const dt = Math.min(1, (now - state.lastSpeedAt) / 1000);
        const before = state.trip.toFixed(1);
        state.trip += (mps * dt) / 1000;
        if (state.trip.toFixed(1) !== before) { renderTrip(); saveTrip(false); }
    }
    state.lastSpeedAt = now;
};

// ---------- 2. RPM (0.0 - 1.0) ----------
window.setRPM = function (rpm) {
    const r = clamp01(Number(rpm) || 0);
    if (r === state.rpm) return;
    state.rpm = r;
    kick();
};

// ---------- 3. Fuel ----------
window.setFuel = function (fuel) {
    const val = Number(fuel) || 0;
    const percent = clamp01(val > 1 ? val / 100 : val);
    state.fuel = percent;
    elHud.classList.toggle('fuel-low', percent < CONFIG.fuelLow);
    setBar('fuel', percent);
};

// ---------- 4. Engine health -> check engine otomatis saat rendah ----------
function updateWarnings() {
    const h = state.health;
    const engineCls = h <= 0.3 ? ' on-red' : (state.checkEngine || h <= 0.5) ? ' on-amber' : '';
    setClass($('ind-engine'), 'ind' + engineCls);
    setClass($('ind-oil'), 'ind' + (state.oilWarn ? ' on-red' : ''));
    setClass($('ind-batt'), 'ind' + (state.battWarn ? ' on-red' : ''));
}
window.setHealth = function (health) {
    const val = Number(health) || 0;
    const percent = clamp01(val > 1 ? val / 1000 : val);
    if (percent === state.health) return;
    state.health = percent;
    updateWarnings();
};
window.setCheckEngine = function (on) { state.checkEngine = isTrueValue(on); updateWarnings(); };
window.setOilWarning = function (on) { state.oilWarn = isTrueValue(on); updateWarnings(); };
window.setBatteryWarning = function (on) { state.battWarn = isTrueValue(on); updateWarnings(); };

// ---------- 5. Gear ----------
window.setGear = function (gear) {
    let g = String(gear);
    if (gear === null || gear === undefined || g === '' || g.toUpperCase() === 'N') g = 'N';
    else if (gear == 0 || g === '0' || g.toUpperCase() === 'R') g = 'R';
    setText($('gear'), g);
    const col = g === 'R' ? '#ff2a2f' : '';
    if ($('gear').style.color !== col) $('gear').style.color = col;
};

// ---------- 6. Lock / unlock (indikator gembok tidak ada di desain; status tetap disimpan) ----------
window.updateLockStatus = function (val) {
    state.locked = isLockedState(val);
    elHud.classList.toggle('is-locked', state.locked);
};
window.toggleLock = function (val) { window.updateLockStatus(val === undefined ? !state.locked : val); };
window.setDoors = window.updateLockStatus;
window.setDoorLock = window.updateLockStatus;
window.setVehicleLocked = window.updateLockStatus;
window.setLocked = window.updateLockStatus;
window.setLock = window.updateLockStatus;

// ---------- 7. Lampu (0 = mati, 1 = low beam, 2 = high beam) ----------
window.setHeadlights = function (val) {
    const v = Number(val) || 0;
    setClass($('hl-high'), v === 2 ? 'ind on-blue' : 'ind');
    setClass($('hl-low'), v === 1 ? 'ind on-green' : 'ind');
};

// ---------- 8. Sein (tidak ada di desain, dibiarkan no-op agar pemanggilan lama tidak error) ----------
window.setLeftIndicator = function () {};
window.setRightIndicator = function () {};

// ---------- 9. Seatbelt (true = terpasang) ----------
window.setSeatbelts = function (val) {
    state.belted = isTrueValue(val);
    setClass($('seatbelts'), state.belted ? 'ind on-green' : 'ind on-red');
};

// ---------- 10. Odometer (input sesuai CONFIG.odoInputUnit, tampil KM 6 digit) ----------
window.setOdometer = function (distance) {
    const d = Math.max(0, Number(distance) || 0);
    const km = CONFIG.odoInputUnit === 'mi' ? d * MI_TO_KM : d;
    setText($('odometer'), String(Math.floor(km)).padStart(6, '0'));
};

// ---------- 11. Suhu mesin (derajat C) ----------
window.setTemp = function (celsius) {
    const c = Number(celsius) || 0;
    setBar('temp', (c - CONFIG.tempMinC) / (CONFIG.tempMaxC - CONFIG.tempMinC));
    elHud.classList.toggle('temp-hot', c >= CONFIG.tempHotC);
};

// ---------- Engine (JGVRP: setEngine(true/false)) ----------
window.setEngine = function (on) { state.engine = isTrueValue(on); };

// ---------- Intro (bisa dipanggil ulang: playIntro()) ----------
let introTimer;
window.playIntro = function () {
    elHud.classList.remove('intro-on');
    void elHud.offsetWidth;                 // restart animasi CSS
    elHud.classList.add('intro-on');
    bootUntil = performance.now() + BOOT_MS;   // bar RPM ikut menyapu
    kick();
    clearTimeout(introTimer);
    introTimer = setTimeout(() => elHud.classList.remove('intro-on'), 2750);
};

// ---------- Suara peringatan (Web Audio, tanpa file mp3) ----------
// Ubah nilai di SND untuk mengatur suara. Matikan semua: setHudSound(false)
const SND = {
    enabled: true,
    volume: 0.3,            // 0 - 1
    seatbeltEvery: 2000,    // ms jeda antar bunyi seatbelt (berulang sampai seatbelt dipasang)
    seatbeltMinSpeed: 1,    // m/s: seatbelt hanya bunyi saat mobil lebih cepat dari ini (0 = selalu)
    fuelBelow: 0.20,        // bensin di bawah 20%
    fuelEvery: 30000,       // ms jeda antar chime bensin
};
// Suara hanya bunyi kalau mesin HIDUP (setEngine(true)).
// Matikan via link: ?nosound / ?mute / ?silent / ?noalarm   Volume via link: ?volume=0.0-1.0
const query = new URLSearchParams(location.search);
['nosound', 'mute', 'silent', 'noalarm', 'noseatbelt', 'nobelt'].forEach((k) => {
    if (query.has(k) && !['0', 'false', 'no', 'off'].includes((query.get(k) || '').toLowerCase())) SND.enabled = false;
});
if (query.has('volume') && !isNaN(parseFloat(query.get('volume')))) SND.volume = clamp01(parseFloat(query.get('volume')));

let audioCtx = null;
function getAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}
function tone(freq, start, dur, type, vol) {
    const a = getAudio();
    if (!a) return;
    const t0 = a.currentTime + start;
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, SND.volume * vol), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
}
window.playHudSound = function (kind) {
    if (!SND.enabled) return;
    if (kind === 'seatbelt') {                       // beep-beep
        tone(1000, 0.00, 0.14, 'triangle', 1);
        tone(1000, 0.22, 0.14, 'triangle', 1);
    } else if (kind === 'fuel') {                    // ding-dong
        tone(988, 0.00, 0.45, 'sine', 1);
        tone(1976, 0.00, 0.30, 'sine', 0.25);
        tone(740, 0.30, 0.70, 'sine', 1);
        tone(1480, 0.30, 0.45, 'sine', 0.25);
    }
};
window.setHudSound = function (on, volume) {
    SND.enabled = !!on;
    if (volume !== undefined) SND.volume = clamp01(Number(volume));
};
// Alias kontrol suara (nama sama dengan template JGVRP)
window.setSeatbeltSoundEnabled = (on) => window.setHudSound(!!on, undefined);
window.setSeatbeltVolume = (v) => { const n = parseFloat(v); if (!isNaN(n)) window.setHudSound(SND.enabled, n); };
// Browser butuh interaksi pertama untuk membuka audio (di CEF/FiveM biasanya langsung jalan)
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, getAudio, { once: true }));

let lastSeatBeep = -Infinity, lastFuelChime = -Infinity;
setInterval(() => {
    if (!SND.enabled || elHud.classList.contains('intro-on')) return;
    const now = performance.now();

    // Seatbelt: mesin hidup + belum dipasang + mobil bergerak
    const seatWarn = state.engine && !state.belted && state.mps > SND.seatbeltMinSpeed;
    if (!seatWarn) lastSeatBeep = -Infinity;          // kondisi hilang -> siap bunyi lagi saat muncul
    else if (now - lastSeatBeep >= SND.seatbeltEvery) {
        lastSeatBeep = now;
        window.playHudSound('seatbelt');
    }

    // Bensin rendah dan mesin hidup
    const fuelWarn = state.engine && state.fuel < SND.fuelBelow;
    if (!fuelWarn) lastFuelChime = -Infinity;
    else if (now - lastFuelChime >= SND.fuelEvery) {
        lastFuelChime = now;
        window.playHudSound('fuel');
    }
}, 250);

// ---------- Tema (hanya warna aksen; tombol / tekan T) ----------
// [id, nama tampil, aksen RGB, aksen terang RGB]
const THEMES = [
    ['blue',  'Biru',  [25, 182, 255], [120, 222, 255]],
    ['red',   'Merah', [255, 42, 47],  [255, 120, 122]],
    ['ice',   'Ice',   [61, 224, 255], [170, 243, 255]],
    ['amber', 'Amber', [255, 176, 32], [255, 214, 128]],
    ['green', 'Hijau', [34, 214, 90],  [141, 255, 176]],
];
const THEME_ALIAS = { lfa: 'blue', night: 'red', mono: 'green' };   // nama tema versi lama
let themeIdx = 0, themeColors = { a: THEMES[0][2].slice(), l: THEMES[0][3].slice() }, themeRaf = 0;

function paintTheme(a, l) {
    const root = document.documentElement.style;
    root.setProperty('--accent', rgbStr(a));
    root.setProperty('--accent-rgb', a.map(Math.round).join(','));
    root.setProperty('--accent-light', rgbStr(l));
    recolor(a, l);
}
function tweenTheme(a1, l1) {                       // perpindahan warna dihaluskan 0.5 detik
    cancelAnimationFrame(themeRaf);
    const a0 = themeColors.a.slice(), l0 = themeColors.l.slice(), t0 = performance.now(), D = 500;
    (function step(now) {
        const t = clamp01((now - t0) / D);
        themeColors = { a: mixRgb(a0, a1, t), l: mixRgb(l0, l1, t) };
        paintTheme(themeColors.a, themeColors.l);
        if (t < 1) themeRaf = requestAnimationFrame(step);
    })(t0);
}
window.setTheme = function (name, animate) {
    let i = typeof name === 'number' ? name : THEMES.findIndex((t) => t[0] === (THEME_ALIAS[name] || name));
    if (i < 0 || isNaN(i)) i = 0;
    themeIdx = ((i % THEMES.length) + THEMES.length) % THEMES.length;
    const th = THEMES[themeIdx];
    document.body.dataset.theme = th[0];
    setText($('theme-name'), th[1]);
    try { localStorage.setItem('hudTheme', th[0]); } catch (e) {}
    if (animate === false) { themeColors = { a: th[2].slice(), l: th[3].slice() }; paintTheme(th[2], th[3]); }
    else tweenTheme(th[2], th[3]);
};
window.nextTheme = () => window.setTheme(themeIdx + 1);
$('theme-btn').addEventListener('click', window.nextTheme);
window.addEventListener('keydown', (e) => { if (e.key === 't' || e.key === 'T') window.nextTheme(); });

// ---------- Pesan NUI (satu dispatcher) ----------
// Format: window.postMessage({ action: 'setSpeed', speed: 12.3 })  atau  { type: 'lock', status: true }
const ACTIONS = {
    setEngine:      (d) => window.setEngine(d.state),
    setSpeed:       (d) => window.setSpeed(Number(d.speed) || 0),
    setRPM:         (d) => window.setRPM(Number(d.rpm) || 0),
    setFuel:        (d) => window.setFuel(Number(d.fuel) || 0),
    setHealth:      (d) => window.setHealth(Number(d.health) || 0),
    setGear:        (d) => window.setGear(d.gear !== undefined ? d.gear : 'N'),
    setHeadlights:  (d) => window.setHeadlights(Number(d.state) || 0),
    setSeatbelts:   (d) => window.setSeatbelts(!!d.state),
    setOdometer:    (d) => window.setOdometer(Number(d.distance) || 0),
    setTemp:        (d) => window.setTemp(d.temp !== undefined ? d.temp : d.value),
    setCheckEngine: (d) => window.setCheckEngine(d.state),
    setOilWarning:  (d) => window.setOilWarning(d.state),
    setBatteryWarning: (d) => window.setBatteryWarning(d.state),
    setTrip:        (d) => window.setTrip(d.trip !== undefined ? d.trip : d.value),
    resetTrip:      () => window.resetTrip(),
    setDoors:       (d) => window.updateLockStatus(d.status !== undefined ? d.status : d.state),
    lock:           (d) => window.updateLockStatus(d.status !== undefined ? d.status : d.state),
    playIntro:      () => window.playIntro(),
    setTheme:       (d) => window.setTheme(d.theme !== undefined ? d.theme : d.state),
    nextTheme:      () => window.nextTheme(),
    muteSeatbelt:   () => window.setSeatbeltSoundEnabled(false),
    unmuteSeatbelt: () => window.setSeatbeltSoundEnabled(true),
    setSeatbeltSound: (d) => window.setSeatbeltSoundEnabled(d.enabled !== undefined ? !!d.enabled : !d.disabled),
    setVolume:      (d) => window.setSeatbeltVolume(d.volume !== undefined ? d.volume : d.value),
};
window.addEventListener('message', function (event) {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    const fn = ACTIONS[d.action] || ACTIONS[d.type];
    if (!fn) return;
    try { fn(d); } catch (e) { /* abaikan pesan rusak */ }
});

// ---------- Opsi lewat URL: ?theme=red  ?anchor=center|left|right  ?scale=0.5  ?button ----------
(function () {
    if (query.has('button')) document.body.classList.add('show-btn');
    const anchor = query.get('anchor');
    if (anchor === 'center' || anchor === 'left') document.body.dataset.anchor = anchor;
    const sc = parseFloat(query.get('scale'));
    if (!isNaN(sc) && sc > 0) document.documentElement.style.setProperty('--scale', String(sc));
})();

// ---------- Nilai awal ----------
window.setSpeed(0);
state.lastSpeedAt = 0;
window.setRPM(0);
window.setFuel(100);
window.setHealth(1000);
window.setGear('N');
window.setHeadlights(0);
window.setSeatbelts(false);
window.setEngine(false);
window.updateLockStatus(false);
window.setOdometer(0);
window.setTemp(90);
renderTrip();
(function () {
    let saved = query.get('theme');
    try { saved = saved || localStorage.getItem('hudTheme'); } catch (e) {}
    window.setTheme(saved || 'blue', false);
})();

window.playIntro();   // animasi intro saat HUD pertama kali dipakai

// ---------- Mode: GAME (default) atau DEMO ----------
// DEMO hanya aktif dengan ?demo (atau otomatis di preview netlify.app kecuali ?nodemo).
// Di mode GAME tidak ada data palsu: HUD hanya bergerak dari pemanggilan fungsi / pesan NUI di atas.
const IS_DEMO = query.has('demo') || (/netlify\.app$/.test(location.hostname) && !query.has('nodemo'));
window.HUD_MODE = IS_DEMO ? 'demo' : 'game';
document.body.dataset.mode = window.HUD_MODE;

if (IS_DEMO) {
    document.body.classList.add('preview');
    // Font Google hanya dimuat di demo browser (di game pakai font lokal, lihat README)
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800;900&family=Rajdhani:wght@500;600;700&display=swap';
    document.head.appendChild(fonts);

    if (!query.has('scale')) {                       // pas-kan HUD ke lebar jendela browser
        const fit = () => document.documentElement.style.setProperty('--scale', String(Math.min(1, (innerWidth - 48) / 1200)));
        fit();
        window.addEventListener('resize', fit);
    }

    const GEAR_TOP = [0, 45, 77, 116, 158, 206, 265];   // batas km/h per gigi
    let mps = 0, gear = 1, throttle = true, odo = 18452.3, health = 1000, fuel = 86, t = 0;

    setTimeout(() => {
        setEngine(true);
        setTimeout(() => setSeatbelts(true), 9000);   // belum dipasang 9 detik pertama -> terdengar beep
        setHeadlights(1);
        setInterval(() => {
            t += 0.05;
            const kmh = mps * CONFIG.speedFactor;
            if (throttle) mps += 0.38 / gear; else mps -= 0.55;
            if (kmh > 240) throttle = false;
            if (mps <= 0) { mps = 0; throttle = true; }

            while (gear < 6 && kmh > GEAR_TOP[gear]) gear++;
            while (gear > 1 && kmh < GEAR_TOP[gear - 1] - 10) gear--;
            const lo = GEAR_TOP[gear - 1], hi = GEAR_TOP[gear];
            const rpm = 0.11 + clamp01((kmh - lo) / (hi - lo)) * (throttle ? 0.89 : 0.6);

            health = Math.max(180, health - 0.9);
            if (health <= 180) health = 1000;
            fuel = fuel <= 4 ? 86 : fuel - 0.02;
            odo += (kmh / MI_TO_KM * 0.05) / 3600;

            setSpeed(mps);
            setRPM(rpm);
            setGear(gear);
            setHealth(health);
            setFuel(fuel);
            setOdometer(odo);
            setTemp(80 + 28 * Math.abs(Math.sin(t / 18)));
            setHeadlights(Math.floor(t / 9) % 3 === 2 ? 2 : 1);
            updateLockStatus(Math.floor(t / 7) % 2);
            setOilWarning(Math.floor(t / 12) % 4 === 3);
            setBatteryWarning(Math.floor(t / 15) % 4 === 3);
        }, 50);
    }, 3000);
}
