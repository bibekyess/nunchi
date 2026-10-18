import Dexie, { type EntityTable } from 'dexie';
import type { Session, Utterance } from '@/lib/types';

/** What the recent sessions list shows about a session's lines. */
export interface SessionStats {
  /** First translated line. */
  preview?: string;
  /** Lines that weren't skipped. */
  lineCount: number;
}

/**
 * A session as stored. The stats are kept on the record so the home page doesn't have to read
 * every line of every session; records written by an older version may not have them yet.
 */
export type SavedSession = Session & Partial<SessionStats>;

/** Stats for a session's utterances, given in seq order. */
export function sessionStats(utterances: Iterable<Utterance>): SessionStats {
  let preview: string | undefined;
  let lineCount = 0;
  for (const u of utterances) {
    if (preview === undefined && u.status === 'done' && u.translation) preview = u.translation;
    if (u.status !== 'skipped') lineCount++;
  }
  return { preview, lineCount };
}

/** On-device storage. Audio is never stored; only text and session metadata. */
export class NunchiDB extends Dexie {
  sessions!: EntityTable<SavedSession, 'id'>;
  utterances!: EntityTable<Utterance, 'id'>;

  constructor(name = 'nunchi') {
    super(name);
    const stores = {
      sessions: 'id, createdAt',
      utterances: 'id, sessionId, [sessionId+seq]',
    };
    this.version(1).stores(stores);
    // v2 keeps list stats on each session record; fill them in for sessions saved before.
    this.version(2)
      .stores(stores)
      .upgrade(async (tx) => {
        const sessions = tx.table<SavedSession, string>('sessions');
        const utterances = tx.table<Utterance, string>('utterances');
        for (const { id } of await sessions.toArray()) {
          const lines = await utterances
            .where('[sessionId+seq]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .toArray();
          await sessions.update(id, { ...sessionStats(lines) });
        }
      });
  }
}

let instance: NunchiDB | null = null;

export function db(): NunchiDB {
  instance ??= new NunchiDB();
  return instance;
}

/** Test hook: point the module at a fresh database. */
export function setDb(next: NunchiDB | null) {
  instance = next;
}

export interface SessionSummary {
  session: Session;
  /** First translated line, for the recent sessions list. */
  preview?: string;
  utteranceCount: number;
}

function bySeq(sessionId: string) {
  return db()
    .utterances.where('[sessionId+seq]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey]);
}

/** The stats are storage-only: they never reach the store or the pipeline. */
function withoutStats(saved: SavedSession): Session {
  const session = { ...saved };
  delete session.preview;
  delete session.lineCount;
  return session;
}

export async function loadSession(
  id: string,
): Promise<{ session: Session; utterances: Utterance[] } | null> {
  return db().transaction('r', db().sessions, db().utterances, async () => {
    const saved = await db().sessions.get(id);
    if (!saved) return null;
    return { session: withoutStats(saved), utterances: await bySeq(id).toArray() };
  });
}

/** Without stats, the session is listed by reading its lines until it is saved with them. */
export async function saveSession(
  session: Session,
  utterances: Utterance[] = [],
  stats?: SessionStats,
) {
  await db().transaction('rw', db().sessions, db().utterances, async () => {
    await db().sessions.put({ ...session, ...stats });
    if (utterances.length) await db().utterances.bulkPut(utterances);
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  return db().transaction('r', db().sessions, db().utterances, async () => {
    const saved = await db().sessions.orderBy('createdAt').reverse().toArray();
    return Promise.all(
      saved.map(async (record) => {
        const { preview, lineCount } =
          record.lineCount === undefined
            ? sessionStats(await bySeq(record.id).toArray())
            : { preview: record.preview, lineCount: record.lineCount };
        return { session: withoutStats(record), preview, utteranceCount: lineCount };
      }),
    );
  });
}

export async function renameSession(id: string, title: string) {
  await db().sessions.update(id, { title });
}

export async function deleteSession(id: string) {
  await db().transaction('rw', db().sessions, db().utterances, async () => {
    await db().utterances.where('sessionId').equals(id).delete();
    await db().sessions.delete(id);
  });
}
