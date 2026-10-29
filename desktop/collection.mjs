import { mkdirSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';

const filenames = ['all-experiments.json', 'all-experiments.csv', 'all-experiments.xlsx'];

// Each format uses exactly the same table, including sessions with no responses.
export function collectionTable(sessions, { sessionColumns, sessionRecords }) {
  const columns = ['snapshot_id', 'snapshot_updated_at', 'record_type', ...sessionColumns,
    'session_revision', 'pending_interrupted', 'study_signature', 'image_ids',
    'enable_keyboard', 'enable_mouse', 'randomize_image_order', 'show_image_during_rating',
    'session_status', 'ratings_recorded', 'ratings_expected'];
  const snapshotId = randomUUID();
  const updatedAt = new Date().toISOString();
  const records = sessions.flatMap(session => {
    const ratings = sessionRecords(session);
    const empty = Object.fromEntries(sessionColumns.map(column => [column, null]));
    Object.assign(empty, { schema_version: session.schemaVersion, session_id: session.sessionId,
      session_started_at: session.startedAt, session_completed_at: session.completedAt,
      time_limit_ms: session.settings.timeLimitMs, rating_order: session.settings.ratingOrder.join(' then ') });
    return (ratings.length ? ratings : [empty]).map(row => ({
      snapshot_id: snapshotId, snapshot_updated_at: updatedAt,
      record_type: ratings.length ? 'rating' : 'session', ...row,
      session_revision: session.revision, pending_interrupted: session.pendingInterrupted,
      study_signature: session.studySignature, image_ids: JSON.stringify(session.imageIds),
      enable_keyboard: session.settings.enableKeyboard, enable_mouse: session.settings.enableMouse,
      randomize_image_order: session.settings.randomizeImageOrder,
      show_image_during_rating: session.settings.showImageDuringRating,
      session_status: session.completedAt === null ? 'partial' : 'complete',
      ratings_recorded: session.responses.length, ratings_expected: session.imageIds.length * 2,
    }));
  });
  return { schemaVersion: 1, snapshotId, updatedAt, columns, records };
}

export function writeCollection(directory, sessions, serializers, atomicWrite) {
  const root = join(directory, 'exports');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Invalid export folder.');
  const data = collectionTable(sessions, serializers);
  const target = join(root, data.snapshotId);
  mkdirSync(target, { mode: 0o700 });
  try {
    const workbook = XLSX.utils.book_new();
    // Split at Excel's row limit instead of silently truncating large collections.
    const chunkSize = 1_048_575;
    for (let offset = 0, number = 1; offset < Math.max(1, data.records.length); offset += chunkSize, number++) {
      const sheet = XLSX.utils.aoa_to_sheet([data.columns,
        ...data.records.slice(offset, offset + chunkSize).map(row => data.columns.map(column => row[column]))]);
      sheet['!autofilter'] = { ref: sheet['!ref'] };
      XLSX.utils.book_append_sheet(workbook, sheet, `Experiments ${number}`);
    }
    atomicWrite(join(target, filenames[0]), JSON.stringify(data, null, 2) + '\n');
    atomicWrite(join(target, filenames[1]), serializers.csvTable(data.columns, data.records));
    atomicWrite(join(target, filenames[2]), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
    // Publish only after all three files are durable. Never replace an open workbook.
    const manifest = { snapshotId: data.snapshotId, updatedAt: data.updatedAt, directory: target, files: filenames,
      sessionCount: sessions.length, ratingCount: sessions.reduce((total, session) => total + session.responses.length, 0) };
    atomicWrite(join(root, 'CURRENT.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } catch (error) {
    // A directory fsync can fail after the manifest rename has committed.
    // Retain staged files on any error; the next successful publication prunes orphans.
    throw error;
  }
}

export function pruneCollections(directory, keep) {
  for (const name of readdirSync(join(directory, 'exports'))) {
    if (/^[a-f0-9-]{36}$/.test(name) && !keep.has(name)) {
      try { rmSync(join(directory, 'exports', name), { recursive: true, force: true }); }
      catch { /* An open file may prevent cleanup on Windows; retry after the next save. */ }
    }
  }
}
