import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Run the actual app with controlled DOM events, image delivery, and timers.
// This tests behavior without adding a browser or DOM dependency.
const source = stripTypeScriptTypes(
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, ''),
);

function setup(overrides = {}, imageList = ['plate', 'chair'], environment = {}) {
  class Element {
    hidden = false;
    disabled = false;
    textContent = '';
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
    append(child) { this.children.push(child); }
    querySelectorAll() { return this.children; }
  }
  const nodes = Object.fromEntries([
    'start-button', 'screen-description', 'status', 'rating-panel',
    'study-image', 'rating-buttons', 'rating-question', 'scale-labels', 'retry-image',
  ].map(id => [id, new Element()]));
  const document = new Element();
  document.activeElement = null;
  document.querySelector = selector => nodes[selector.slice(1)];
  document.createElement = () => new Element();
  const timers = new Map();
  const timerDelays = new Map();
  let timerId = 0;
  const errors = [];
  runInNewContext(source, {
    document,
    HTMLButtonElement: Element,
    console: { error: error => errors.push(error) },
    crypto: environment.crypto ?? { randomUUID: () => 'test-session', getRandomValues: array => array.fill(17) },
    images: imageList.map(id => ({ id, src: `/${id}.png`, alt: id })),
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
  });
  const app = {
    nodes, timers, timerDelays, errors, document,
    begin() { nodes['start-button'].emit('click'); nodes['start-button'].emit('click'); },
    load() {
      nodes['study-image'].complete = true;
      nodes['study-image'].naturalWidth = 100;
      nodes['study-image'].emit('load');
    },
    click(value, details) { nodes['rating-buttons'].children[value - 1].emit('click', details); },
    key(key, details) { document.emit('keydown', { key, ...details }); },
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
