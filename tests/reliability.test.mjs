import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Run the actual app with controlled DOM events, images, frames, and timers.
// This tests behavior without adding a browser or DOM dependency.
const source = stripTypeScriptTypes(
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, ''),
);
const sessionModule = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(
  readFileSync(new URL('../src/session.ts', import.meta.url), 'utf8'),
)));

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

function setup(overrides = {}, imageList = ['plate', 'chair'], environment = {}) {
  class Element {
    hidden = false;
    disabled = false;
    textContent = '';
    value = '';
    children = [];
    listeners = {};
    complete = false;
    naturalWidth = 0;
    assignments = 0;
    _src = '';
    set src(value) {
      this._src = value;
      this.assignments++;
      this.complete = environment.cachedImage ?? false;
      this.naturalWidth = this.complete ? 100 : 0;
    }
    get src() { return this._src; }
    removeAttribute(name) { if (name === 'src') this._src = ''; }
    focus() { document.activeElement = this; }
    addEventListener(type, callback) {
      (this.listeners[type] ??= []).push(callback);
    }
    emit(type, details = {}) {
      if (type === 'click' && this.disabled) return;
      for (const callback of this.listeners[type] ?? []) {
        callback({ detail: 1, preventDefault() {}, ...details });
      }
    }
    append(child) { this.children.push(child); if (!this.value && child.value) this.value = child.value; }
    querySelectorAll() { return this.children; }
  }
  const nodes = Object.fromEntries([
    'start-button', 'screen-description', 'status', 'rating-panel',
    'study-image', 'rating-buttons', 'rating-question', 'scale-labels', 'retry-image',
    'session-info', 'session-select', 'saved-sessions', 'resume-session', 'download-saved',
    'storage-status', 'download-session', 'new-session',
  ].map(id => [id, new Element()]));
  const document = new Element();
  document.baseURI = 'https://study.test/ainogo/';
  document.activeElement = null;
  document.visibilityState = 'visible';
  document.querySelector = selector => nodes[selector.slice(1)];
  document.createElement = () => new Element();
  const window = new Element();
  const storage = environment.storage ?? new MemoryStorage();
  let now = 0;
  const timers = new Map();
  const timerDelays = new Map();
  const frames = new Map();
  let frameId = 0;
  const flushFrames = () => {
    for (let turn = 0; turn < 2; turn++) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  };
  const settle = () => { if (!environment.manualFrames) flushFrames(); };
  let timerId = 0;
  const errors = [];
  runInNewContext(source, {
    ...sessionModule,
    document,
    window,
    localStorage: storage,
    performance: { now: () => now },
    URL,
    HTMLButtonElement: Element,
    console: { error: error => errors.push(error) },
    crypto: environment.crypto ?? { randomUUID: () => 'test-session', getRandomValues: array => array.fill(17) },
    images: imageList.map(id => ({ id, src: environment.imageSources?.[id] ?? `/${id}.png`, alt: id })),
    experimentConfig: {
      randomizeImageOrder: false, ratingOrder: ['valence', 'arousal'],
      showImageDuringRating: true, timeLimitMs: null,
      enableMouse: true, enableKeyboard: true, ...overrides,
    },
    ratingPrompts: {
      valence: { question: 'Valence?', lowAnchor: 'low', highAnchor: 'high' },
      arousal: { question: 'Arousal?', lowAnchor: 'low', highAnchor: 'high' },
    },
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, () => {
        timers.delete(id);
        timerDelays.delete(id);
        callback();
      });
      timerDelays.set(id, delay);
      return id;
    },
    clearTimeout: id => { timers.delete(id); timerDelays.delete(id); },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const app = {
    nodes, timers, timerDelays, errors, document, window, storage, frames, flushFrames,
    advance(ms) { now += ms; },
    begin() { nodes['start-button'].emit('click'); nodes['start-button'].emit('click'); settle(); },
    load() {
      nodes['study-image'].complete = true;
      nodes['study-image'].naturalWidth = 100;
      nodes['study-image'].emit('load');
      settle();
    },
    click(value, details) { nodes['rating-buttons'].children[value - 1].emit('click', details); settle(); },
    key(key, details) { document.emit('keydown', { key, ...details }); settle(); },
    description: () => nodes['screen-description'].textContent,
    status: () => nodes.status.textContent,
  };
  return app;
}

test('completes every image once, preserves both ratings, ignores later input', () => {
  const app = setup();
  app.begin();
  app.load();
  app.click(2); app.key('8');
  app.load();
  app.key('3'); app.click(7);
  assert.match(app.description(), /complete/);
  assert.match(app.status(), /1\. plate: valence 2, arousal 8/);
  assert.match(app.status(), /2\. chair: valence 3, arousal 7/);
  const final = app.status();
  app.click(1); app.key('9');
  assert.equal(app.status(), final);
});

test('held and modified keys cannot accidentally record ratings', () => {
  const app = setup(); app.begin(); app.load();
  for (const details of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    app.key('4', details);
    assert.match(app.description(), /select one valence/);
  }
});

test('second click of a double-click does not rate the next dimension', () => {
  const app = setup(); app.begin(); app.load();
  app.click(4); app.click(4, { detail: 2 });
  assert.match(app.description(), /Image 1.*arousal/);
});

test('touch click counts do not suppress intentional responses on new questions', () => {
  const app = setup({ enableKeyboard: false }); app.begin(); app.load();
  for (let image = 0; image < 2; image++) {
    if (image > 0) app.load();
    for (const [value, detail] of [[2, 2], [8, 3]]) {
      app.nodes['rating-buttons'].children[value - 1].emit('pointerdown');
      app.click(value, { pointerType: 'touch', detail });
    }
  }
  assert.match(app.description(), /complete/);
  assert.match(app.status(), /plate: valence 2, arousal 8/);
});

test('touch activation with zero click detail still respects pointer controls', () => {
  const app = setup({ enableKeyboard: false }); app.begin(); app.load();
  app.nodes['rating-buttons'].children[1].emit('pointerdown');
  app.click(2, { pointerType: 'touch', detail: 0 });
  assert.match(app.description(), /arousal/);
  const keyboardOnly = setup({ enableMouse: false }); keyboardOnly.begin(); keyboardOnly.load();
  keyboardOnly.click(2, { pointerType: 'touch', detail: 0 });
  assert.match(keyboardOnly.description(), /valence/);
});

test('touch gestures with zero click detail still cannot cross question boundaries', () => {
  const app = setup(); app.begin(); app.load();
  app.nodes['rating-buttons'].children[3].emit('pointerdown');
  app.key('2');
  app.click(4, { pointerType: 'touch', detail: 0 });
  assert.match(app.description(), /Image 1.*arousal/);
});

test('loading and failed images block both input paths and retry preserves progress', () => {
  const app = setup(); app.begin();
  app.click(5); app.key('6');
  assert.match(app.description(), /Image 1.*valence/);
  app.nodes['study-image'].emit('error');
  assert.match(app.status(), /could not be loaded/);
  app.key('5');
  assert.match(app.description(), /Image 1.*valence/);
  assert.equal(app.nodes['retry-image'].hidden, false);
  app.nodes['retry-image'].emit('click'); app.load();
  app.click(2); app.key('8');
  app.load(); app.click(3); app.click(7);
  assert.match(app.status(), /plate: valence 2, arousal 8/);
});

test('the same image is not reloaded between its two ratings', () => {
  const app = setup(); app.begin(); app.load();
  app.click(3);
  assert.equal(app.nodes['study-image'].assignments, 1);
});

test('arousal-first messages reflect the actual completed dimension', () => {
  const app = setup({ ratingOrder: ['arousal', 'valence'] });
  app.begin(); app.load();
  assert.doesNotMatch(app.status(), /Valence recorded/);
  app.click(8);
  assert.match(app.status(), /Arousal recorded.*valence/);
});

test('mouse-only mode rejects numeric keyboard input', () => {
  const app = setup({ enableKeyboard: false }); app.begin(); app.load();
  app.key('9'); assert.match(app.description(), /valence/);
  app.click(1); assert.match(app.description(), /arousal/);
});

test('keyboard-only mode accepts keys and rejects mouse clicks', () => {
  const app = setup({ enableMouse: false }); app.begin(); app.load();
  app.click(1); assert.match(app.description(), /valence/);
  app.key('9'); assert.match(app.description(), /arousal/);
});

test('timers start after loading, expire with a reminder, and clear on completion', () => {
  const app = setup({ timeLimitMs: 100 }, ['plate']); app.begin();
  assert.deepEqual([...app.timerDelays.values()], [15_000]);
  app.load(); assert.equal(app.timers.size, 1);
  assert.deepEqual([...app.timerDelays.values()], [100]);
  [...app.timers.values()][0]();
  assert.match(app.status(), /Time limit reached/);
  app.click(1); assert.equal(app.timers.size, 1);
  app.click(9); assert.equal(app.timers.size, 0);
});

test('invalid input cannot advance the study', () => {
  const app = setup(); app.begin(); app.load();
  for (const key of ['0', '10', ' ', 'Enter', 'a']) app.key(key);
  assert.match(app.description(), /Image 1.*valence/);
});

test('invalid configuration shows an unavailable screen and disables Start', () => {
  for (const app of [
    setup({}, []),
    setup({ ratingOrder: ['valence', 'valence'] }),
    setup({ enableKeyboard: false, enableMouse: false }),
  ]) {
    assert.equal(app.nodes['start-button'].disabled, true);
    assert.match(app.status(), /cannot start/);
    assert.equal(app.errors.length, 1);
  }
});

test('invalid timer values are rejected', () => {
  for (const timeLimitMs of [-1, 0, NaN, Infinity, 2 ** 31]) {
    const app = setup({ timeLimitMs });
    assert.equal(app.nodes['start-button'].disabled, true);
    assert.match(app.errors[0].message, /time limit/i);
  }
});

test('hidden-image trials cannot collect responses without a presentation phase', () => {
  const app = setup({ showImageDuringRating: false }); app.begin();
  assert.equal(app.nodes['start-button'].disabled, true);
  assert.match(app.status(), /cannot start/);
  assert.match(app.errors[0].message, /presentation phase/);
});

test('cached images accept ratings without waiting for a new load event', () => {
  const app = setup({}, ['plate'], { cachedImage: true }); app.begin();
  app.click(1); app.click(9);
  assert.match(app.description(), /complete/);
});

test('sessions start on HTTP when randomUUID is unavailable', () => {
  const app = setup({}, ['plate'], { crypto: { getRandomValues: array => array.fill(17) } });
  app.begin(); app.load(); app.click(1); app.click(9);
  assert.match(app.description(), /complete/);
});

test('randomized sessions preserve every image exactly once', () => {
  const ids = ['plate', 'chair', 'hammer', 'stool'];
  const app = setup({ randomizeImageOrder: true }, ids); app.begin();
  for (const id of ids) { app.load(); app.click(2); app.click(8); }
  assert.match(app.description(), /complete/);
  for (const id of ids) {
    assert.equal(app.status().split(`${id}: valence 2, arousal 8`).length - 1, 1);
  }
});

test('late image events cannot overwrite the completed response summary', () => {
  const app = setup({}, ['plate']); app.begin(); app.load(); app.click(1); app.click(9);
  const final = app.status();
  app.nodes['study-image'].emit('error'); app.load();
  assert.equal(app.status(), final);
});

test('double-clicking Start leaves instructions available', () => {
  const app = setup();
  app.nodes['start-button'].emit('click');
  app.nodes['start-button'].emit('click', { detail: 2 });
  assert.equal(app.nodes['start-button'].textContent, 'Begin');
  assert.equal(app.nodes['rating-panel'].hidden, true);
});

test('stalled images time out, ignore late loads, and can be retried', () => {
  const app = setup({}, ['plate']); app.begin();
  [...app.timers.values()][0]();
  assert.match(app.status(), /could not be loaded/);
  app.load(); app.key('5');
  assert.match(app.description(), /valence/);
  app.nodes['retry-image'].emit('click');
  app.load(); app.key('2'); app.key('8');
  assert.match(app.description(), /complete/);
  assert.equal(app.timers.size, 0);
});

test('keyboard-only mode supports native button activation', () => {
  const app = setup({ enableMouse: false }); app.begin(); app.load();
  assert.equal(app.nodes['rating-buttons'].children[3].disabled, false);
  app.click(4, { detail: 0 });
  assert.match(app.description(), /arousal/);
});

test('mouse-only mode rejects native keyboard activation', () => {
  const app = setup({ enableKeyboard: false }); app.begin(); app.load();
  app.click(4, { detail: 0 });
  assert.match(app.description(), /valence/);
});

test('unrelated repeated keys retain browser default behavior', () => {
  const app = setup(); app.begin(); app.load();
  let prevented = false;
  app.key('ArrowDown', { repeat: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test('a mouse gesture started on an earlier prompt cannot rate the next prompt', () => {
  const app = setup(); app.begin(); app.load();
  app.nodes['rating-buttons'].children[3].emit('pointerdown');
  app.key('2');
  app.click(4);
  assert.match(app.description(), /Image 1.*arousal/);
});

test('native keyboard activation does not clear a held mouse gesture from the old prompt', () => {
  const app = setup(); app.begin(); app.load();
  app.nodes['rating-buttons'].children[3].emit('pointerdown');
  app.click(4, { detail: 0 });
  app.click(4);
  assert.match(app.description(), /Image 1.*arousal/);
});

test('pressing a disabled rating while loading cannot record after the image arrives', () => {
  const app = setup(); app.begin();
  app.nodes['rating-buttons'].children[3].emit('pointerdown');
  app.load(); app.click(4);
  assert.match(app.description(), /Image 1.*valence/);
});

test('retry URLs retain query parameters and fragments while changing the network URL', () => {
  const app = setup({}, ['plate'], {
    imageSources: { plate: 'plate.png?size=large&retry=old#stimulus' },
  });
  app.begin();
  for (let attempt = 1; attempt <= 2; attempt++) {
    app.nodes['study-image'].emit('error');
    app.nodes['retry-image'].emit('click');
    const url = new URL(app.nodes['study-image'].src);
    assert.equal(url.pathname, '/ainogo/plate.png');
    assert.equal(url.searchParams.get('size'), 'large');
    assert.deepEqual(url.searchParams.getAll('retry'), [String(attempt)]);
    assert.equal(url.hash, '#stimulus');
  }
  app.load(); app.click(2); app.key('8');
  assert.match(app.description(), /complete/);
});

test('duplicate or empty image IDs cannot silently corrupt recorded image identity', () => {
  for (const ids of [['plate', 'plate'], ['plate', ' ']]) {
    const app = setup({}, ids);
    assert.equal(app.nodes['start-button'].disabled, true);
    assert.match(app.errors[0].message, /unique, non-empty IDs/);
  }
});

test('input and rating-order combinations preserve all recorded values', () => {
  for (const ratingOrder of [['valence', 'arousal'], ['arousal', 'valence']]) {
    for (const [enableMouse, enableKeyboard] of [[true, false], [false, true], [true, true]]) {
      for (const cachedImage of [true, false]) {
        for (const timeLimitMs of [null, 50]) {
          const app = setup({ ratingOrder, enableMouse, enableKeyboard, timeLimitMs },
            ['plate', 'chair'], { cachedImage });
          app.begin();
          for (let index = 1; index <= 2; index++) {
            if (!cachedImage) app.load();
            for (const dimension of ratingOrder) {
              const value = dimension === 'valence' ? index + 1 : index + 5;
              if (enableMouse) app.click(value);
              else app.click(value, { detail: 0 });
            }
          }
          assert.match(app.description(), /complete/);
          assert.match(app.status(), /1\. plate: valence 2, arousal 6/);
          assert.match(app.status(), /2\. chair: valence 3, arousal 7/);
          assert.equal(app.timers.size, 0);
        }
      }
    }
  }
});

test('responses are blocked until each new question has a rendering opportunity', () => {
  const app = setup({}, ['plate'], { manualFrames: true });
  app.begin(); app.load();
  assert.equal(app.nodes['rating-buttons'].children[1].disabled, true);
  app.key('2');
  assert.match(app.description(), /valence/);
  app.flushFrames();
  app.key('2'); app.key('8');
  assert.match(app.description(), /arousal/);
  app.flushFrames(); app.key('8');
  assert.match(app.description(), /complete/);
});

test('image errors cancel pending presentation callbacks without re-enabling input', () => {
  const app = setup({}, ['plate'], { manualFrames: true });
  app.begin(); app.load();
  assert.equal(app.frames.size, 1);
  app.nodes['study-image'].emit('error');
  app.flushFrames();
  assert.equal(app.frames.size, 0);
  assert.equal(app.nodes['rating-buttons'].children[0].disabled, true);
  assert.equal(app.nodes['retry-image'].hidden, false);
});

test('rating timers start after presentation and all callbacks clear on completion', () => {
  const app = setup({ timeLimitMs: 100 }, ['plate'], { manualFrames: true });
  app.begin(); app.load();
  assert.equal(app.timers.size, 0);
  app.flushFrames();
  assert.equal(app.timers.size, 1);
  app.key('2');
  assert.equal(app.timers.size, 0);
  app.flushFrames();
  assert.equal(app.timers.size, 1);
  app.key('8');
  assert.equal(app.timers.size, 0);
  assert.equal(app.frames.size, 0);
});

const savedData = app => sessionModule.readSessions(app.storage).sessions[0];

test('per-rating reaction times exclude loading and presentation delays', () => {
  const app = setup({}, ['plate'], { manualFrames: true });
  app.begin(); app.advance(5000); app.load(); app.advance(2000); app.flushFrames();
  app.advance(125.25); app.key('2');
  app.advance(3000); app.flushFrames(); app.advance(76); app.click(8);
  const saved = savedData(app);
  assert.equal(saved.responses.length, 2);
  assert.equal(saved.responses[0].reactionTimeMs, 125.25);
  assert.equal(saved.responses[1].reactionTimeMs, 76);
  assert.equal(saved.responses[0].inputMethod, 'keyboard');
  assert.equal(saved.responses[1].inputMethod, 'mouse');
  assert.equal(saved.responses[0].ratingPosition, 1);
  assert.equal(saved.responses[1].ratingPosition, 2);
  assert.ok(saved.completedAt);
});

test('limit flags use each response elapsed time rather than timer callback delivery', () => {
  const app = setup({ timeLimitMs: 100 }, ['plate']); app.begin(); app.load();
  app.advance(120); app.key('2'); app.advance(10); app.key('8');
  const saved = savedData(app);
  assert.equal(saved.responses[0].exceededTimeLimit, true);
  assert.equal(saved.responses[1].exceededTimeLimit, false);
});

test('reload recovery preserves partial ratings and image order, and flags the restarted prompt', () => {
  const first = setup({ randomizeImageOrder: true }); first.begin(); first.load();
  first.advance(123); first.key('2');
  const before = savedData(first);
  const resumed = setup({ randomizeImageOrder: true }, ['plate', 'chair'], { storage: first.storage });
  assert.equal(resumed.nodes['saved-sessions'].hidden, false);
  resumed.nodes['resume-session'].emit('click'); resumed.load(); resumed.advance(77); resumed.key('8');
  resumed.load(); resumed.key('3'); resumed.key('7');
  const after = savedData(resumed);
  assert.equal(after.sessionId, before.sessionId);
  assert.deepEqual(after.imageIds, before.imageIds);
  assert.deepEqual(after.responses[0], before.responses[0]);
  assert.equal(after.responses[1].interrupted, true);
  assert.equal(after.responses[1].reactionTimeMs, 77);
  assert.equal(after.responses[2].interrupted, false);
  assert.equal(after.responses.length, 4);
  assert.match(resumed.description(), /complete/);
});

test('focus interruptions pause input and restart timing with an interruption flag', () => {
  const app = setup({}, ['plate']); app.begin(); app.load(); app.advance(100); app.key('2');
  app.window.emit('blur'); app.advance(9000); app.key('8');
  assert.equal(savedData(app).responses.length, 1);
  app.window.emit('focus'); app.flushFrames(); app.advance(42); app.key('8');
  const saved = savedData(app);
  assert.equal(saved.responses[0].interrupted, false);
  assert.equal(saved.responses[1].interrupted, true);
  assert.equal(saved.responses[1].reactionTimeMs, 42);
});

test('redundant focus events cannot reset an uninterrupted reaction time', () => {
  const app = setup({}, ['plate']); app.begin(); app.load(); app.advance(80);
  app.window.emit('focus'); app.advance(20); app.key('2');
  assert.equal(savedData(app).responses[0].reactionTimeMs, 100);
});

test('completed sessions are retained separately from subsequent sessions', () => {
  const first = setup({}, ['plate']); first.begin(); first.load(); first.key('2'); first.key('8');
  const next = setup({}, ['plate'], { storage: first.storage, crypto: { randomUUID: () => 'session-two' } });
  next.begin(); next.load(); next.key('3'); next.key('7');
  const sessions = sessionModule.readSessions(first.storage).sessions;
  assert.equal(sessions.length, 2);
  assert.deepEqual(new Set(sessions.map(s => s.sessionId)), new Set(['test-session', 'session-two']));
});

test('incompatible studies allow download but not resume', () => {
  const first = setup(); first.begin(); first.load(); first.key('2');
  const changed = setup({ ratingOrder: ['arousal', 'valence'] }, ['plate', 'chair'], { storage: first.storage });
  assert.equal(changed.nodes['resume-session'].disabled, true);
  assert.equal(changed.nodes['download-saved'].disabled, false);
});

test('blocked storage and quota errors keep recording in memory and show a warning', () => {
  for (const storage of [
    { get length() { throw new Error('Blocked'); } },
    Object.assign(new MemoryStorage(), { setItem() { throw new Error('Quota'); } }),
  ]) {
    const app = setup({}, ['plate'], { storage }); app.begin(); app.load(); app.key('2'); app.key('8');
    assert.match(app.description(), /complete/);
    assert.match(app.nodes['storage-status'].textContent, /saving is unavailable/);
    assert.equal(app.nodes['download-session'].hidden, false);
  }
});

test('conflicting revisions stop input without overwriting another tab', () => {
  const app = setup(); app.begin(); app.load();
  const original = savedData(app);
  original.revision++;
  const key = sessionModule.sessionStoragePrefix + original.sessionId;
  app.storage.setItem(key, JSON.stringify(original));
  app.key('2'); app.key('8');
  assert.match(app.nodes['storage-status'].textContent, /another tab/);
  assert.equal(savedData(app).responses.length, 0);
  assert.equal(app.nodes['rating-buttons'].children[0].disabled, true);
});

test('storage events detect same-revision forks and cleared sessions', () => {
  for (const cleared of [false, true]) {
    const app = setup(); app.begin(); app.load(); app.key('2');
    const other = savedData(app);
    other.responses[0].value = 9;
    app.window.emit('storage', { key: cleared ? null : sessionModule.sessionStoragePrefix + other.sessionId,
      newValue: cleared ? null : JSON.stringify(other) });
    assert.match(app.nodes['storage-status'].textContent, /another tab/);
    app.key('8');
    assert.equal(savedData(app).responses.length, 1);
  }
});

test('damaged saved data is ignored without deleting valid or damaged sessions', () => {
  const app = setup({}, ['plate']); app.begin(); app.load(); app.key('2'); app.key('8');
  const valid = savedData(app);
  for (const change of [
    s => { s.responses[0].reactionTimeMs = -1; },
    s => { s.responses[1].dimension = 'valence'; },
    s => { s.responses[0].value = 10; },
    s => { s.completedAt = null; },
    s => { s.responses[0].exceededTimeLimit = true; },
  ]) {
    const bad = structuredClone(valid); change(bad);
    assert.equal(sessionModule.parseSession(JSON.stringify(bad)), null);
  }
  const key = sessionModule.sessionStoragePrefix + 'broken';
  app.storage.setItem(key, '{');
  const result = sessionModule.readSessions(app.storage);
  assert.equal(result.damaged, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(app.storage.getItem(key), '{');
});

test('CSV includes one row per rating and safely escapes spreadsheet formulas and quotes', () => {
  const app = setup({}, ['plate']); app.begin(); app.load(); app.key('2'); app.key('8');
  const saved = savedData(app);
  const csv = sessionModule.sessionCsv(saved);
  assert.ok(csv.startsWith('\uFEFF"schema_version"'));
  assert.equal(csv.split('\r\n').length, 4);
  assert.match(csv, /"reaction_time_ms","input_method"/);
  assert.match(csv, /"valence","1","2"/);
  assert.match(csv, /"arousal","2","8"/);
  saved.responses[0].imageFilename = '=HYPERLINK("bad")';
  assert.ok(sessionModule.sessionCsv(saved).includes('"\'=HYPERLINK(""bad"")"'));
  saved.responses[0].imageFilename = 'a,b"c\nd';
  assert.ok(sessionModule.sessionCsv(saved).includes('"a,b""c\nd"'));
});
