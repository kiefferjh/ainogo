export type RatingDimension = 'valence' | 'arousal';
export type InputMethod = 'keyboard' | 'mouse' | 'touch' | 'pen';
export type SessionSettings = {
  ratingOrder: readonly RatingDimension[];
  timeLimitMs: number | null;
  enableKeyboard: boolean;
  enableMouse: boolean;
  randomizeImageOrder: boolean;
  showImageDuringRating: boolean;
};
export type RatingResponse = {
  imageId: string;
  imageFilename: string;
  imageOrder: number;
  dimension: RatingDimension;
  ratingPosition: number;
  value: number;
  reactionTimeMs: number;
  inputMethod: InputMethod;
  respondedAt: string;
  exceededTimeLimit: boolean;
  interrupted: boolean;
};
export type StudySession = {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  completedAt: string | null;
  studySignature: string;
  imageIds: string[];
  settings: SessionSettings;
  responses: RatingResponse[];
  pendingInterrupted: boolean;
  revision: number;
};

export const sessionStoragePrefix = 'ainogo.session.v1.';
export class SessionConflictError extends Error {}
export type SessionStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

// Treat browser storage as untrusted input. Only complete, sequential records
// from this schema can be resumed or exported through the application.
export function parseSession(raw: string): StudySession | null {
  try {
    const s = JSON.parse(raw);
    if (!s || s.schemaVersion !== 1 || typeof s.sessionId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(s.sessionId) || !isDate(s.startedAt) ||
        (s.completedAt !== null && !isDate(s.completedAt)) ||
        typeof s.studySignature !== 'string' || !s.studySignature ||
        typeof s.pendingInterrupted !== 'boolean' || !Number.isSafeInteger(s.revision) || s.revision < 0 ||
        !Array.isArray(s.imageIds) || !s.imageIds.length ||
        s.imageIds.some((id: unknown) => typeof id !== 'string' || !id.trim()) ||
        new Set(s.imageIds).size !== s.imageIds.length) return null;
    const c = s.settings;
    if (!c || !Array.isArray(c.ratingOrder) || c.ratingOrder.length !== 2 ||
        !c.ratingOrder.includes('valence') || !c.ratingOrder.includes('arousal') ||
        (c.timeLimitMs !== null && (!Number.isFinite(c.timeLimitMs) || c.timeLimitMs <= 0 || c.timeLimitMs > 2_147_483_647)) ||
        ['enableKeyboard', 'enableMouse', 'randomizeImageOrder', 'showImageDuringRating']
          .some(key => typeof c[key] !== 'boolean') ||
        (!c.enableKeyboard && !c.enableMouse) || !c.showImageDuringRating ||
        !Array.isArray(s.responses) || s.responses.length > s.imageIds.length * 2 ||
        ((s.completedAt !== null) !== (s.responses.length === s.imageIds.length * 2))) return null;
    for (let index = 0; index < s.responses.length; index++) {
      const r = s.responses[index];
      if (!r || r.imageId !== s.imageIds[Math.floor(index / 2)] ||
          r.imageOrder !== Math.floor(index / 2) + 1 || r.dimension !== c.ratingOrder[index % 2] ||
          r.ratingPosition !== index % 2 + 1 || typeof r.imageFilename !== 'string' || !r.imageFilename ||
          !Number.isInteger(r.value) || r.value < 1 || r.value > 9 ||
          !Number.isFinite(r.reactionTimeMs) || r.reactionTimeMs < 0 ||
          !['keyboard', 'mouse', 'touch', 'pen'].includes(r.inputMethod) || !isDate(r.respondedAt) ||
          typeof r.exceededTimeLimit !== 'boolean' || typeof r.interrupted !== 'boolean' ||
          r.exceededTimeLimit !== (c.timeLimitMs !== null && r.reactionTimeMs >= c.timeLimitMs)) return null;
    }
    return s as StudySession;
  } catch {
    return null;
  }
}

export function readSessions(storage: SessionStorage): { sessions: StudySession[]; damaged: boolean } {
  const sessions: StudySession[] = [];
  let damaged = false;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(sessionStoragePrefix)) continue;
    const session = parseSession(storage.getItem(key) ?? '');
    if (session && key === sessionStoragePrefix + session.sessionId) sessions.push(session);
    else damaged = true;
  }
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { sessions, damaged };
}

export function saveSession(storage: SessionStorage, session: StudySession): void {
  const key = sessionStoragePrefix + session.sessionId;
  const existing = storage.getItem(key);
  if (existing !== null) {
    const saved = parseSession(existing);
    if (!saved || saved.revision !== session.revision) {
      throw new SessionConflictError('This session changed in another tab.');
    }
  } else if (session.revision !== 0) {
    throw new SessionConflictError('The saved session was removed in another tab.');
  }
  const next = { ...session, revision: session.revision + 1 };
  storage.setItem(key, JSON.stringify(next));
  session.revision = next.revision;
}

function csvCell(value: string | number | boolean | null): string {
  // CSV quoting alone does not prevent spreadsheet formula execution.
  let text = value === null ? '' : String(value);
  if (typeof value === 'string' && /^(\s*[=+@-]|[\t\r])/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const sessionColumns = [
    'schema_version', 'session_id', 'session_started_at', 'session_completed_at',
    'image_id', 'image_filename', 'image_order', 'rating_dimension', 'rating_position',
    'rating_value', 'reaction_time_ms', 'input_method', 'responded_at',
    'time_limit_ms', 'exceeded_time_limit', 'interrupted', 'rating_order',
];

export function sessionRecords(session: StudySession): Record<string, string | number | boolean | null>[] {
  return session.responses.map(r => {
    const values = [session.schemaVersion, session.sessionId, session.startedAt, session.completedAt,
      r.imageId, r.imageFilename, r.imageOrder, r.dimension, r.ratingPosition,
      r.value, r.reactionTimeMs, r.inputMethod, r.respondedAt,
      session.settings.timeLimitMs, r.exceededTimeLimit, r.interrupted,
      session.settings.ratingOrder.join(' then ')];
    return Object.fromEntries(sessionColumns.map((column, index) => [column, values[index]]));
  });
}

export function csvTable(columns: string[], records: Record<string, string | number | boolean | null>[]): string {
  return '\uFEFF' + [columns, ...records.map(row => columns.map(column => row[column] ?? null))]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function sessionCsv(session: StudySession): string {
  return csvTable(sessionColumns, sessionRecords(session));
}
