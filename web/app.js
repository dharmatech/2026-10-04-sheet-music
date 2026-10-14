'use strict';

// Note-name helper: point at a column of notes in LilyPond SVG output and
// see their names. The SVG comes from lilypond/tag-noteheads.ily, which puts
// data-* attributes (onset, duration, pitch, staff, voice, …) on every notehead.

// ---------- per-score settings ----------

const SCORE = {
  dir: '../build/svg/',
  manifest: 'clair-de-lune.json',
  // Which hand each printed staff belongs to.
  staffHand: { upper: 'rh', lower: 'lh' },
  // Which hand each Voice belongs to (voice ids from the Mutopia source).
  voiceHand: { red: 'rh', green: 'rh', blue: 'lh', grey: 'lh' },
};

const GROUP_ORDER = ['rh', 'lh'];
const GROUP_LABELS = {
  staff: { rh: ['Upper staff', 'RH'], lh: ['Lower staff', 'LH'] },
  hand: { rh: ['Right hand', 'RH'], lh: ['Left hand', 'LH'] },
};

const ACCIDENTALS = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
const ACCIDENTAL_WORDS = { '-2': 'double flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double sharp' };
const STEP_ORDER = 'CDEFGAB';
const UNIT_NAMES = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth', 32: '32nd' };

// How far (in SVG units, roughly staff spaces) above the first system and
// below the last one the pointer still counts as being on that system.
const SYSTEM_REACH = 10;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- exact fractions (onsets are rationals like 27/8) ----------

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

class Q {
  constructor(n, d = 1) {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static parse(s) {
    const [n, d] = s.split('/');
    return new Q(Number(n), d === undefined ? 1 : Number(d));
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  cmp(o) { return Math.sign(this.n * o.d - o.n * this.d); }
  lt(o) { return this.cmp(o) < 0; }
  valueOf() { return this.n / this.d; }
}

// ---------- settings ----------

const STORAGE_KEY = 'note-name-helper.settings';
const settings = { held: true, octave: true, offkey: true, group: 'staff' };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
} catch { /* storage unavailable: keep defaults */ }

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---------- model ----------

const notes = [];     // every real note (\hideNotes placeholders excluded)
const columns = [];   // one per distinct onset, in time order
const systems = [];   // in page order, each with its columns sorted by x
let current = null;   // selected column

function readNote(el, page) {
  const d = el.dataset;
  const onset = Q.parse(d.onset);
  const grace = d.grace ? Q.parse(d.grace) : null;
  return {
    el, page,
    onset, grace,
    // Grace notes take no time on the main timeline, so they are never held.
    end: grace ? onset : onset.add(Q.parse(d.dur)),
    key: grace ? `${d.onset}|${d.grace}` : d.onset,
    step: d.step,
    alter: Number(d.alter),
    keyAlter: Number(d.keyAlter),
    oct: Number(d.oct),
    midi: Number(d.midi),
    ottava: d.ottava ? Number(d.ottava) : 0,
    bar: Number(d.bar),
    pos: Q.parse(d.pos),
    time: d.time,
    voice: d.voice,
    staff: d.staff,
    sys: d.sys,
    src: d.src,
    tied: d.tied === '1',
    merged: d.merged === '1',
  };
}

// Bounding box of `el` in the root SVG's user units, independent of zoom/scroll.
function boxIn(svg, el) {
  const b = el.getBBox();
  const m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
  const p = new DOMPoint(b.x, b.y).matrixTransform(m);
  const q = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
  return {
    x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x),
    y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y),
  };
}

function compareColumns(a, b) {
  return a.onset.cmp(b.onset) || (a.grace ? a.grace.valueOf() : 0) - (b.grace ? b.grace.valueOf() : 0);
}

function buildModel(pages) {
  const byKey = new Map();
  for (const page of pages) {
    // Systems on this page, from their staff lines.
    const pageSystems = new Map();
    for (const st of page.svg.querySelectorAll('g.staff')) {
      const b = boxIn(page.svg, st);
      let s = pageSystems.get(st.dataset.sys);
      if (!s) {
        s = { key: st.dataset.sys, page, top: Infinity, bottom: -Infinity,
              left: Infinity, right: -Infinity, columns: [] };
        pageSystems.set(s.key, s);
      }
      s.top = Math.min(s.top, b.y0);
      s.bottom = Math.max(s.bottom, b.y1);
      s.left = Math.min(s.left, b.x0);
      s.right = Math.max(s.right, b.x1);
    }
    // Vertical bands: each system owns the space up to halfway to its neighbours.
    page.systems = [...pageSystems.values()].sort((a, b) => a.top - b.top);
    page.systems.forEach((s, i, all) => {
      s.bandTop = i ? (all[i - 1].bottom + s.top) / 2 : s.top - SYSTEM_REACH;
      s.bandBottom = i < all.length - 1 ? (s.bottom + all[i + 1].top) / 2 : s.bottom + SYSTEM_REACH;
    });
    systems.push(...page.systems);

    for (const el of page.svg.querySelectorAll('g.note')) {
      if (el.dataset.hidden === '1') continue;
      const n = readNote(el, page);
      n.system = pageSystems.get(n.sys);
      if (!n.merged) n.box = boxIn(page.svg, el);
      notes.push(n);
      let col = byKey.get(n.key);
      if (!col) {
        col = { key: n.key, onset: n.onset, grace: n.grace, system: n.system, page, notes: [] };
        byKey.set(n.key, col);
      }
      col.notes.push(n);
    }
  }

  for (const col of byKey.values()) {
    const boxes = col.notes.filter(n => n.box).map(n => n.box);
    if (!boxes.length || !col.system) continue;
    col.x0 = Math.min(...boxes.map(b => b.x0));
    col.x1 = Math.max(...boxes.map(b => b.x1));
    col.y0 = Math.min(...boxes.map(b => b.y0));
    col.y1 = Math.max(...boxes.map(b => b.y1));
    col.cx = boxes.reduce((sum, b) => sum + (b.x0 + b.x1) / 2, 0) / boxes.length;
    columns.push(col);
    col.system.columns.push(col);
  }
  columns.sort(compareColumns);
  columns.forEach((c, i) => { c.index = i; });
  for (const s of systems) s.columns.sort((a, b) => a.cx - b.cx);
}

// A column with nothing struck (only tied-over notes) is only worth landing
// on when held notes are shown.
function navigable(col) {
  return settings.held || col.notes.some(n => !n.tied);
}

function struckAt(col) {
  return col.notes.filter(n => !n.tied);
}

function heldAt(col) {
  const t = col.onset;
  return notes.filter(n =>
    (n.key === col.key && n.tied) ||
    (!n.grace && n.onset.lt(t) && t.lt(n.end)));
}

function groupOf(n) {
  if (settings.group === 'hand' && n.voice in SCORE.voiceHand) return SCORE.voiceHand[n.voice];
  return SCORE.staffHand[n.staff] || 'rh';
}

// ---------- names ----------

function pitchKey(n) { return `${n.step}${n.alter}/${n.oct}`; }

function comparePitch(a, b) {
  return a.midi - b.midi || STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step);
}

function isOffKey(n) { return n.alter !== n.keyAlter; }

function nameText(n) {
  const acc = ACCIDENTALS[n.alter] ?? '';
  return `${n.step}${acc}${settings.octave ? n.oct : ''}`;
}

function noteTitle(n) {
  const parts = [`${n.step}${ACCIDENTALS[n.alter] ?? ''}${n.oct}`, `MIDI ${n.midi}`];
  if (isOffKey(n)) {
    parts.push(`${ACCIDENTAL_WORDS[n.alter]}: key signature says ${ACCIDENTAL_WORDS[n.keyAlter]}`);
  }
  if (n.ottava) parts.push(`under ${n.ottava > 0 ? '8va' : '8vb'}: written an octave ${n.ottava > 0 ? 'lower' : 'higher'}`);
  parts.push(`${n.staff} staff`, `voice “${n.voice}”`, `source line ${n.src}`);
  return parts.join(' · ');
}

function chip(n, held) {
  const el = document.createElement('span');
  el.className = 'chip' + (held ? ' held' : '');
  el.title = noteTitle(n);

  const offKey = settings.offkey && isOffKey(n);
  if (offKey) el.classList.add('offkey');

  el.append(n.step);
  // Off-key naturals get an explicit ♮ so they stand out from the key's flats/sharps.
  const acc = ACCIDENTALS[n.alter] || (offKey ? '♮' : '');
  if (acc) {
    const a = document.createElement('span');
    a.className = 'acc';
    a.textContent = acc;
    el.append(a);
  }
  if (settings.octave) {
    const o = document.createElement('span');
    o.className = 'oct';
    o.textContent = n.oct;
    el.append(o);
  }
  const tags = [];
  if (n.ottava) tags.push(n.ottava > 0 ? '8va' : '8vb');
  if (settings.group === 'hand' && SCORE.staffHand[n.staff] !== groupOf(n)) {
    tags.push(`on ${n.staff} staff`);
  }
  for (const t of tags) {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    el.append(s);
  }
  return el;
}

function uniqueByPitch(list) {
  const seen = new Map();
  for (const n of list) if (!seen.has(pitchKey(n))) seen.set(pitchKey(n), n);
  return [...seen.values()].sort(comparePitch);
}

function positionText(col) {
  const n = col.notes[0];
  const [num, den] = n.time.split('/').map(Number);
  const unit = UNIT_NAMES[den] || `1/${den}`;
  const k = n.pos.valueOf() * den + 1;
  const kText = Number.isInteger(k) ? String(k) : k.toFixed(2).replace(/0+$/, '');
  const where = `${unit} ${kText} of ${num}`;
  return col.grace ? `grace note before ${where}` : where;
}

// ---------- piano keyboard ----------

const piano = { keys: new Map(), marks: null, blackMarks: null };

function buildPiano() {
  const svg = document.getElementById('piano');
  const lo = Math.max(21, Math.min(...notes.map(n => n.midi)) - 3);
  const hi = Math.min(108, Math.max(...notes.map(n => n.midi)) + 3);
  const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  let first = lo; while (isBlack(first)) first--;
  let last = hi; while (isBlack(last)) last++;

  const W = 10, H = 48, BW = 6.2, BH = 30, LABEL = 9;
  const whites = [];
  for (let m = first; m <= last; m++) if (!isBlack(m)) whites.push(m);
  svg.setAttribute('viewBox', `0 0 ${whites.length * W} ${H + LABEL}`);
  svg.replaceChildren();

  const layer = cls => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', cls);
    svg.append(g);
    return g;
  };
  const whiteLayer = layer('whites');
  piano.marks = layer('marks');
  const blackLayer = layer('blacks');
  piano.blackMarks = layer('marks');
  const labelLayer = layer('labels');

  const rect = (parent, x, y, w, h, cls) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => r.setAttribute(k, v));
    r.setAttribute('class', cls);
    parent.append(r);
    return r;
  };

  whites.forEach((m, i) => {
    rect(whiteLayer, i * W, 0, W, H, 'wk');
    piano.keys.set(m, { x: i * W + 0.8, y: BH + 1, w: W - 1.6, h: H - BH - 2.5, black: false });
    if (m % 12 === 0) {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', i * W + W / 2);
      t.setAttribute('y', H + LABEL - 2);
      t.setAttribute('class', 'clabel' + (m === 60 ? ' middle' : ''));
      t.textContent = `C${m / 12 - 1}`;
      labelLayer.append(t);
    }
  });
  for (let m = first + 1; m < last; m++) {
    if (!isBlack(m)) continue;
    const x = whites.indexOf(m - 1) * W + W - BW / 2;
    rect(blackLayer, x, 0, BW, BH, 'bk');
    piano.keys.set(m, { x: x + 0.9, y: BH - 11, w: BW - 1.8, h: 9.5, black: true });
  }
}

function drawPianoMarks(struck, held) {
  piano.marks.replaceChildren();
  piano.blackMarks.replaceChildren();
  // midi -> Map(group -> held?); a struck note wins over a held one.
  const byKey = new Map();
  const add = (n, isHeld) => {
    const groups = byKey.get(n.midi) || new Map();
    const g = groupOf(n);
    groups.set(g, (groups.get(g) ?? true) && isHeld);
    byKey.set(n.midi, groups);
  };
  held.forEach(n => add(n, true));
  struck.forEach(n => add(n, false));

  for (const [midi, groups] of byKey) {
    const k = piano.keys.get(midi);
    if (!k) continue;
    const list = GROUP_ORDER.filter(g => groups.has(g)).map(g => ({ g, held: groups.get(g) }));
    const w = k.w / list.length;
    list.forEach((mark, i) => {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', k.x + i * w);
      r.setAttribute('y', k.y);
      r.setAttribute('width', w);
      r.setAttribute('height', k.h);
      r.setAttribute('rx', 1.2);
      r.setAttribute('class', `mark-${mark.g}${mark.held ? ' held' : ''}`);
      (k.black ? piano.blackMarks : piano.marks).append(r);
    });
  }
}

// ---------- rendering ----------

let lit = [];

function render() {
  for (const el of lit) el.classList.remove('is-struck', 'is-held', 'g-rh', 'g-lh');
  lit = [];
  document.querySelectorAll('.col-hl').forEach(r => r.setAttribute('visibility', 'hidden'));

  const whereEl = document.getElementById('where');
  const subEl = document.getElementById('where-sub');
  const groupsEl = document.getElementById('groups');

  if (!current) {
    whereEl.textContent = 'Point at a column of notes';
    subEl.textContent = 'or press → to step through the score';
    groupsEl.replaceChildren();
    drawPianoMarks([], []);
    return;
  }

  const col = current;
  const struck = struckAt(col);
  const held = settings.held ? heldAt(col) : [];

  // Score: column band + coloured noteheads.
  const hl = col.page.highlight;
  const s = col.system;
  hl.setAttribute('x', col.x0 - 0.6);
  hl.setAttribute('width', col.x1 - col.x0 + 1.2);
  hl.setAttribute('y', Math.min(s.top, col.y0) - 1.5);
  hl.setAttribute('height', Math.max(s.bottom, col.y1) - Math.min(s.top, col.y0) + 3);
  hl.setAttribute('visibility', 'visible');
  for (const [list, cls] of [[held, 'is-held'], [struck, 'is-struck']]) {
    for (const n of list) {
      n.el.classList.add(cls, `g-${groupOf(n)}`);
      lit.push(n.el);
    }
  }

  // Panel.
  whereEl.textContent = `Bar ${col.notes[0].bar} · ${positionText(col)}`;
  subEl.textContent = `Column ${col.index + 1} of ${columns.length} · page ${col.page.number}`;

  const labels = GROUP_LABELS[settings.group];
  groupsEl.replaceChildren(...GROUP_ORDER.map(g => {
    const mine = struck.filter(n => groupOf(n) === g);
    const struckPitches = new Set(mine.map(pitchKey));
    const heldMine = held.filter(n => groupOf(n) === g && !struckPitches.has(pitchKey(n)));

    const section = document.createElement('section');
    section.className = `group g-${g}`;
    const h = document.createElement('h3');
    const [title, hand] = labels[g];
    h.innerHTML = '<span></span><span class="hand"></span>';
    h.firstChild.textContent = title;
    h.lastChild.textContent = hand;
    section.append(h);

    const row = (label, list, isHeld) => {
      const r = document.createElement('div');
      r.className = 'row';
      const l = document.createElement('span');
      l.className = 'row-label';
      l.textContent = label;
      r.append(l);
      const unique = uniqueByPitch(list);
      if (unique.length) r.append(...unique.map(n => chip(n, isHeld)));
      else {
        const e = document.createElement('span');
        e.className = 'empty';
        e.textContent = '—';
        r.append(e);
      }
      return r;
    };
    section.append(row('play', mine, false));
    if (settings.held && heldMine.length) section.append(row('held', heldMine, true));
    return section;
  }));

  drawPianoMarks(struck, held);
}

// Scroll just enough to show the column's system, keeping it clear of the
// panel when the panel is a bottom sheet (narrow screens). Returns the amount.
function scrollToColumn(col, behavior = 'smooth') {
  const MARGIN = 24;
  const r = col.page.highlight.getBoundingClientRect();
  const panel = document.getElementById('panel').getBoundingClientRect();
  const visibleBottom = (panel.top > innerHeight / 2 ? panel.top : innerHeight) - MARGIN;
  let dy = 0;
  if (r.top < MARGIN) dy = r.top - MARGIN * 2;
  else if (r.bottom > visibleBottom) dy = r.bottom - visibleBottom + MARGIN;
  if (dy) window.scrollBy({ top: dy, behavior });
  return dy;
}

function select(col, { scroll = false } = {}) {
  if (col === current) return;
  current = col;
  render();
  if (scroll && col) scrollToColumn(col);
}

// ---------- navigation ----------

function step(dir) {
  let i = current ? current.index + dir : (dir > 0 ? 0 : columns.length - 1);
  while (i >= 0 && i < columns.length && !navigable(columns[i])) i += dir;
  if (i >= 0 && i < columns.length) select(columns[i], { scroll: true });
}

function stepSystem(dir) {
  let i = current ? systems.indexOf(current.system) + dir : 0;
  for (; i >= 0 && i < systems.length; i += dir) {
    const firstCol = systems[i].columns.filter(navigable).sort(compareColumns)[0];
    if (firstCol) { select(firstCol, { scroll: true }); return; }
  }
}

function jump(toEnd) {
  const list = columns.filter(navigable);
  if (list.length) select(toEnd ? list[list.length - 1] : list[0], { scroll: true });
}

function nearestColumn(system, x) {
  let best = null;
  for (const c of system.columns) {
    if (!navigable(c)) continue;
    if (!best || Math.abs(c.cx - x) < Math.abs(best.cx - x)) best = c;
  }
  return best;
}

// Browsers send synthetic pointer moves when the page scrolls under a still
// mouse; ignore those so keyboard stepping isn't undone.
let lastPointer = { x: NaN, y: NaN };

function onPointer(page, e, force) {
  if (!force && e.clientX === lastPointer.x && e.clientY === lastPointer.y) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(page.svg.getScreenCTM().inverse());
  const sys = page.systems.find(s => p.y >= s.bandTop && p.y < s.bandBottom);
  if (!sys || p.x < sys.left - 2 || p.x > sys.right + 2) return;
  const col = nearestColumn(sys, p.x);
  if (col) select(col);
}

function wireUp(pages) {
  for (const page of pages) {
    page.svg.addEventListener('pointermove', e => onPointer(page, e, false));
    page.svg.addEventListener('click', e => onPointer(page, e, true));
  }

  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('select, textarea, input[type="text"]')) return;
    switch (e.key) {
      case 'ArrowRight': step(1); break;
      case 'ArrowLeft': step(-1); break;
      case 'ArrowDown': stepSystem(1); break;
      case 'ArrowUp': stepSystem(-1); break;
      case 'Home': jump(false); break;
      case 'End': jump(true); break;
      case 'Escape': select(null); break;
      default: return;
    }
    e.preventDefault();
  });

  document.getElementById('prev').addEventListener('click', () => step(-1));
  document.getElementById('next').addEventListener('click', () => step(1));

  const bind = (id, key, prop = 'checked') => {
    const input = document.getElementById(id);
    input[prop] = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input[prop];
      saveSettings();
      render();
    });
  };
  bind('opt-held', 'held');
  bind('opt-octave', 'octave');
  bind('opt-offkey', 'offkey');
  bind('opt-group', 'group', 'value');
}

// ---------- loading ----------

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.text();
}

async function main() {
  const status = document.getElementById('status');
  try {
    const manifest = JSON.parse(await fetchText(SCORE.dir + SCORE.manifest));
    const texts = await Promise.all(manifest.pages.map(p => fetchText(SCORE.dir + p)));
    const scoreEl = document.getElementById('score');
    const pages = texts.map((text, i) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = document.importNode(doc.documentElement, true);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('aria-label', `Page ${i + 1}`);
      // Column highlight sits behind everything else on the page.
      const highlight = document.createElementNS(SVG_NS, 'rect');
      highlight.setAttribute('class', 'col-hl');
      highlight.setAttribute('rx', 0.6);
      highlight.setAttribute('visibility', 'hidden');
      svg.insertBefore(highlight, svg.firstChild);
      const div = document.createElement('div');
      div.className = 'page';
      div.append(svg);
      return { number: i + 1, div, svg, highlight };
    });
    status.remove();
    scoreEl.append(...pages.map(p => p.div));
    buildModel(pages); // getBBox() forces layout, so measuring right away is fine
    buildPiano();
    wireUp(pages);
    render();
  } catch (err) {
    status.classList.add('error');
    status.textContent = `Could not load the score.\n${err.message}\n\n` +
      'Run `make svg`, then serve the project root (`make serve`) and open /web/.';
    console.error(err);
  }
}

main();
