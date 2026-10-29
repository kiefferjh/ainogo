import { mkdirSync, readdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeCollection, pruneCollections } from './collection.mjs';

const prefix = 'ainogo.session.v1.';
const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
const maxBytes = 2 * 1024 * 1024;

// Keep temp files beside their destination so replacement is an atomic rename.
// The previous snapshot is retained separately; no data lives in the app bundle.
export function atomicWrite(filename, text) {
  const temporary = `${filename}.tmp-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, text, 'utf8');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, filename);
    if (process.platform !== 'win32') {
      const directory = openSync(join(filename, '..'), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export class FileSessionStore {
  notices = new Set();
  constructor(directory, parseSession, serializers, collectionWrite = atomicWrite) {
    this.directory = directory;
    this.parseSession = parseSession;
    this.serializers = serializers;
    this.collectionWrite = collectionWrite;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const root = join(directory, 'exports');
      if (lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink()) {
        const previous = JSON.parse(this.read(join(root, 'CURRENT.json')) ?? 'null');
        if (/^[a-f0-9-]{36}$/.test(previous?.snapshotId) && previous.directory === join(root, previous.snapshotId)) {
          this.collection = previous;
        }
      }
    } catch { /* Rebuild missing or damaged collection metadata from session files. */ }
    this.updateCollection();
  }
  id(key) {
    if (typeof key !== 'string' || !key.startsWith(prefix) || !idPattern.test(key.slice(prefix.length))) {
      throw new Error('Invalid session key.');
    }
    return key.slice(prefix.length);
  }
  read(filename) {
    try {
      const stat = lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Invalid session file.');
      return readFileSync(filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  valid(raw, id) {
    const session = raw === null ? null : this.parseSession(raw);
    return session?.sessionId === id ? session : null;
  }
  listKeys() {
    const ids = new Set();
    for (const filename of readdirSync(this.directory)) {
      const match = /^([a-zA-Z0-9-]{1,80})\.json(?:\.bak)?$/.exec(filename);
      if (match) ids.add(match[1]);
    }
    return [...ids].sort().map(id => prefix + id);
  }
  getItem(key) {
    const id = this.id(key);
    const filename = join(this.directory, `${id}.json`);
    const current = this.read(filename);
    if (this.valid(current, id)) return current;
    const previous = this.read(filename + '.bak');
    if (this.valid(previous, id)) {
      this.notices.add(`Recovered the previous saved copy of session ${id}. Its most recent update may be missing.`);
      return previous;
    }
    return current; // Preserve damaged files and let the UI flag them.
  }
  setItem(key, raw) {
    const id = this.id(key);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxBytes) throw new Error('Invalid session data.');
    const next = this.valid(raw, id);
    if (!next) throw new Error('The session data failed validation.');
    const previousRaw = this.getItem(key);
    const previous = this.valid(previousRaw, id);
    if ((previous && next.revision !== previous.revision + 1) || (!previous && next.revision !== 1)) {
      const error = new Error('This session changed. Reload it before saving.');
      error.code = 'SESSION_CONFLICT';
      throw error;
    }
    if (previous) {
      const immutable = ['sessionId', 'startedAt', 'studySignature', 'imageIds', 'settings'];
      if (previous.completedAt || immutable.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key])) ||
          next.responses.length < previous.responses.length || next.responses.length > previous.responses.length + 1 ||
          previous.responses.some((row, index) => JSON.stringify(row) !== JSON.stringify(next.responses[index]))) {
        throw new Error('Previously saved responses cannot be changed or removed.');
      }
    } else if (next.responses.length !== 0) {
      throw new Error('A new session must be saved before recording its first response.');
    }
    const filename = join(this.directory, `${id}.json`);
    const currentRaw = this.read(filename);
    if (currentRaw !== null && !this.valid(currentRaw, id)) {
      atomicWrite(join(this.directory, `${id}.corrupt-${randomUUID()}.json`), currentRaw);
    }
    atomicWrite(filename + '.bak', previous ? previousRaw : raw);
    atomicWrite(filename, raw);
    this.updateCollection();
  }
  updateCollection() {
    try {
      const sessions = [];
      for (const key of this.listKeys()) {
        try {
          const session = this.valid(this.getItem(key), this.id(key));
          if (session) sessions.push(session);
          else this.notices.add(`Session ${this.id(key)} is damaged and could not be included in the combined files.`);
        } catch {
          this.notices.add(`Session ${this.id(key)} could not be read and was preserved outside the combined files.`);
        }
      }
      sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.sessionId.localeCompare(b.sessionId));
      const previous = this.collection?.snapshotId;
      this.collection = writeCollection(this.directory, sessions, this.serializers, this.collectionWrite);
      this.collectionError = '';
      // Keep the current and previous complete snapshots for recovery.
      try { pruneCollections(this.directory, new Set([previous, this.collection.snapshotId])); } catch { /* Non-critical cleanup. */ }
    } catch (error) {
      this.collectionError = `Combined JSON, CSV and Excel files could not be updated: ${error.message}. Individual session files are retained. Retry by reopening the app.`;
    }
  }
  info() {
    return { directory: this.directory, notices: [...this.notices], collection: this.collection ?? null,
      collectionError: this.collectionError };
  }
}
