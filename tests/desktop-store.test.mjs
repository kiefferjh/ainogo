import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { FileSessionStore } from '../desktop/store.mjs';

const { parseSession, sessionStoragePrefix } = await import('data:text/javascript,' + encodeURIComponent(
  stripTypeScriptTypes(readFileSync(new URL('../src/session.ts', import.meta.url), 'utf8'))));
const key = sessionStoragePrefix + 'session-one';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ainogo-store-test-'));
  const store = new FileSessionStore(directory, parseSession);
  const session = { schemaVersion: 1, sessionId: 'session-one', startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null, studySignature: 'study-v1', imageIds: ['plate'],
    settings: { ratingOrder: ['valence', 'arousal'], timeLimitMs: null, enableKeyboard: true,
      enableMouse: true, randomizeImageOrder: false, showImageDuringRating: true },
    responses: [], pendingInterrupted: false, revision: 1 };
  const append = (value = 2) => {
    session.revision++;
    session.responses.push({ imageId: 'plate', imageFilename: 'plate.png', imageOrder: 1, dimension: 'valence',
      ratingPosition: 1, value, reactionTimeMs: 123, inputMethod: 'keyboard', respondedAt: session.startedAt,
      exceededTimeLimit: false, interrupted: false });
  };
  return { directory, store, session, append, filename: join(directory, 'session-one.json') };
}

test('session files persist independently of browser storage and store instances', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session)); f.append();
  f.store.setItem(key, JSON.stringify(f.session));
  const reopened = new FileSessionStore(f.directory, parseSession);
  assert.deepEqual(reopened.listKeys(), [key]);
  assert.equal(JSON.parse(reopened.getItem(key)).responses[0].reactionTimeMs, 123);
  assert.equal(JSON.parse(readFileSync(f.filename + '.bak', 'utf8')).responses.length, 0);
});

test('damaged primary data recovers the previous snapshot and preserves the damaged file', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session)); f.append();
  f.store.setItem(key, JSON.stringify(f.session)); writeFileSync(f.filename, '{');
  const recovered = JSON.parse(f.store.getItem(key));
  assert.equal(recovered.responses.length, 0);
  assert.match(f.store.info().notices[0], /Recovered/);
  recovered.revision++;
  f.store.setItem(key, JSON.stringify(recovered));
  const archived = readdirSync(f.directory).find(name => name.includes('.corrupt-'));
  assert.equal(readFileSync(join(f.directory, archived), 'utf8'), '{');
  assert.ok(parseSession(readFileSync(f.filename, 'utf8')));
});

test('backup-only sessions remain recoverable if the primary file is missing', () => {
  const f = fixture(); writeFileSync(f.filename + '.bak', JSON.stringify(f.session));
  assert.deepEqual(f.store.listKeys(), [key]);
  assert.ok(parseSession(f.store.getItem(key)));
});

test('failed replacement leaves the primary intact and removes its temporary file', () => {
  const f = fixture();
  writeFileSync(f.filename, JSON.stringify(f.session)); mkdirSync(f.filename + '.bak'); f.append();
  assert.throws(() => f.store.setItem(key, JSON.stringify(f.session)));
  assert.equal(JSON.parse(readFileSync(f.filename, 'utf8')).revision, 1);
  assert.equal(readdirSync(f.directory).some(name => name.includes('.tmp-')), false);
});

test('path traversal, invalid payloads, revision conflicts, and changed prior ratings are rejected', () => {
  const f = fixture();
  assert.throws(() => f.store.getItem(sessionStoragePrefix + '../escape'));
  assert.throws(() => f.store.setItem(key, '{}'));
  f.store.setItem(key, JSON.stringify(f.session));
  assert.throws(() => f.store.setItem(key, JSON.stringify(f.session)), /changed/);
  f.append(); f.store.setItem(key, JSON.stringify(f.session));
  f.session.revision++; f.session.responses[0].value = 9;
  assert.throws(() => f.store.setItem(key, JSON.stringify(f.session)), /cannot be changed/);
  assert.equal(JSON.parse(f.store.getItem(key)).responses[0].value, 2);
});

test('session reads reject symbolic links', { skip: process.platform === 'win32' }, () => {
  const f = fixture(); const target = join(f.directory, 'outside.txt');
  writeFileSync(target, JSON.stringify(f.session)); symlinkSync(target, f.filename);
  assert.throws(() => f.store.getItem(key), /Invalid session file/);
});
