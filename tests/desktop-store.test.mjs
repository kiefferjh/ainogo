import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { FileSessionStore, atomicWrite } from '../desktop/store.mjs';
import * as XLSX from 'xlsx';

const { parseSession, sessionStoragePrefix, ...serializers } = await import('data:text/javascript,' + encodeURIComponent(
  stripTypeScriptTypes(readFileSync(new URL('../src/session.ts', import.meta.url), 'utf8'))));
const key = sessionStoragePrefix + 'session-one';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ainogo-store-test-'));
  const store = new FileSessionStore(directory, parseSession, serializers);
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
  const reopened = new FileSessionStore(f.directory, parseSession, serializers);
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

function collection(store) {
  const manifest = JSON.parse(readFileSync(join(store.directory, 'exports', 'CURRENT.json'), 'utf8'));
  const data = JSON.parse(readFileSync(join(manifest.directory, 'all-experiments.json'), 'utf8'));
  const excel = XLSX.read(readFileSync(join(manifest.directory, 'all-experiments.xlsx')), { type: 'buffer' });
  const csv = XLSX.read(readFileSync(join(manifest.directory, 'all-experiments.csv'), 'utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  const excelRows = excel.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(excel.Sheets[name], { defval: null }));
  assert.deepEqual(excelRows, data.records);
  const csvRows = XLSX.utils.sheet_to_json(csv.Sheets[csv.SheetNames[0]], { defval: '' });
  const printable = value => value === null ? '' : String(value);
  assert.deepEqual(csvRows, data.records.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, printable(value)]))));
  assert.equal(manifest.snapshotId, data.snapshotId);
  return { manifest, data };
}

test('all formats stay equivalent across starts, responses, completion, and many participant IDs', () => {
  const f = fixture();
  const original = structuredClone(f.session);
  const ids = [];
  for (let index = 0; index < 25; index++) {
    const session = structuredClone(original);
    session.sessionId = `participant-${index}`;
    ids.push(session.sessionId);
    const key = sessionStoragePrefix + session.sessionId;
    f.store.setItem(key, JSON.stringify(session));
    const begun = collection(f.store);
    assert.equal(begun.manifest.sessionCount, index + 1);
    assert.equal(begun.data.records.filter(row => row.record_type === 'session').length, 1);
    session.revision++;
    session.responses.push({ imageId: 'plate', imageFilename: 'plate.png', imageOrder: 1, dimension: 'valence',
      ratingPosition: 1, value: 2, reactionTimeMs: 123.125, inputMethod: 'keyboard', respondedAt: session.startedAt,
      exceededTimeLimit: false, interrupted: false });
    f.store.setItem(key, JSON.stringify(session));
    assert.equal(collection(f.store).manifest.ratingCount, index * 2 + 1);
    session.responses.push({ ...session.responses[0], dimension: 'arousal', ratingPosition: 2, value: 8 });
    session.revision++; session.completedAt = session.startedAt;
    f.store.setItem(key, JSON.stringify(session));
    assert.equal(collection(f.store).manifest.ratingCount, (index + 1) * 2);
  }
  const final = collection(f.store);
  assert.deepEqual(new Set(final.data.records.map(row => row.session_id)), new Set(ids));
  assert.equal(readdirSync(join(f.directory, 'exports')).filter(name => name !== 'CURRENT.json').length, 2);
  assert.equal(f.store.listKeys().length, 25);
});

test('failed collection write leaves the previous matching trio current and retains new responses', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session));
  const previous = collection(f.store);
  f.store.collectionWrite = (filename, data) => {
    if (filename.endsWith('.xlsx')) throw new Error('Disk unavailable');
    atomicWrite(filename, data);
  };
  f.append(); f.store.setItem(key, JSON.stringify(f.session));
  assert.equal(JSON.parse(f.store.getItem(key)).responses.length, 1);
  assert.equal(collection(f.store).manifest.snapshotId, previous.manifest.snapshotId);
  assert.match(f.store.info().collectionError, /Disk unavailable/);
  const reopened = new FileSessionStore(f.directory, parseSession, serializers);
  assert.equal(collection(reopened).manifest.ratingCount, 1);
  assert.equal(reopened.info().collectionError, '');
});

test('a partial test remains in every format after later participants and restart without CSV export', () => {
  const f = fixture();
  const next = { ...structuredClone(f.session), sessionId: 'session-two' };
  f.store.setItem(key, JSON.stringify(f.session)); f.append();
  f.store.setItem(key, JSON.stringify(f.session));
  const originalResponse = structuredClone(f.session.responses[0]);
  const nextKey = sessionStoragePrefix + next.sessionId;
  f.store.setItem(nextKey, JSON.stringify(next));
  next.responses.push({ ...originalResponse, value: 3 }); next.revision++;
  f.store.setItem(nextKey, JSON.stringify(next));
  next.responses.push({ ...originalResponse, dimension: 'arousal', ratingPosition: 2, value: 7 });
  next.revision++; next.completedAt = next.startedAt;
  f.store.setItem(nextKey, JSON.stringify(next));
  const reopened = new FileSessionStore(f.directory, parseSession, serializers);
  const { data, manifest } = collection(reopened); // Compares JSON, CSV and Excel field by field.
  assert.equal(manifest.sessionCount, 2);
  assert.equal(manifest.ratingCount, 3);
  const [partial] = data.records.filter(row => row.session_id === f.session.sessionId);
  assert.equal(partial.session_status, 'partial');
  assert.equal(partial.ratings_recorded, 1);
  assert.equal(partial.ratings_expected, 2);
  assert.equal(partial.session_completed_at, null);
  assert.equal(partial.reaction_time_ms, originalResponse.reactionTimeMs);
  assert.equal(data.records.filter(row => row.session_status === 'complete').length, 2);
  const recovered = JSON.parse(reopened.getItem(key));
  assert.deepEqual(recovered.responses, [originalResponse]);
  recovered.responses.push({ ...originalResponse, dimension: 'arousal', ratingPosition: 2, value: 8 });
  recovered.revision++; recovered.completedAt = recovered.startedAt;
  reopened.setItem(key, JSON.stringify(recovered));
  const finished = collection(reopened);
  assert.equal(finished.manifest.sessionCount, 2);
  assert.equal(finished.manifest.ratingCount, 4);
  assert.ok(finished.data.records.every(row => row.session_status === 'complete'));
});

test('interrupted publication and deleted combined files rebuild from individual session records', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session));
  const previous = collection(f.store);
  f.store.collectionWrite = (filename, data) => {
    if (filename.endsWith('CURRENT.json')) throw new Error('Interrupted commit');
    atomicWrite(filename, data);
  };
  f.append(); f.store.setItem(key, JSON.stringify(f.session));
  assert.equal(collection(f.store).manifest.snapshotId, previous.manifest.snapshotId);
  rmSync(join(f.directory, 'exports'), { recursive: true });
  const reopened = new FileSessionStore(f.directory, parseSession, serializers);
  assert.equal(collection(reopened).manifest.ratingCount, 1);
});

test('a failure reported after manifest replacement never removes the published files', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session));
  f.store.collectionWrite = (filename, data) => {
    atomicWrite(filename, data);
    if (filename.endsWith('CURRENT.json')) throw new Error('Directory flush failed after rename');
  };
  f.append(); f.store.setItem(key, JSON.stringify(f.session));
  assert.equal(collection(f.store).manifest.ratingCount, 1);
  assert.match(f.store.info().collectionError, /Directory flush/);
});

test('Excel keeps formula-like image names as text and CSV protects spreadsheet imports', () => {
  const f = fixture(); f.store.setItem(key, JSON.stringify(f.session)); f.append();
  f.session.responses[0].imageFilename = '=HYPERLINK("bad")';
  f.store.setItem(key, JSON.stringify(f.session));
  const directory = f.store.info().collection.directory;
  const workbook = XLSX.read(readFileSync(join(directory, 'all-experiments.xlsx')), { type: 'buffer' });
  const records = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  assert.equal(records[0].image_filename, '=HYPERLINK("bad")');
  assert.equal(Object.values(workbook.Sheets[workbook.SheetNames[0]]).some(cell => cell?.f), false);
  assert.match(readFileSync(join(directory, 'all-experiments.csv'), 'utf8'), /'\=HYPERLINK/);
});
