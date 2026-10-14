import Dexie, { type EntityTable } from 'dexie';
import type { Session, Utterance } from '@/lib/types';

/** On-device storage. Audio is never stored; only text and session metadata. */
export class NunchiDB extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  utterances!: EntityTable<Utterance, 'id'>;

  constructor(name = 'nunchi') {
    super(name);
    this.version(1).stores({
      sessions: 'id, createdAt',
      utterances: 'id, sessionId, [sessionId+seq]',
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

export async function loadSession(
  id: string,
): Promise<{ session: Session; utterances: Utterance[] } | null> {
  return db().transaction('r', db().sessions, db().utterances, async () => {
    const session = await db().sessions.get(id);
    if (!session) return null;
    return { session, utterances: await bySeq(id).toArray() };
  });
}

export async function saveSession(session: Session, utterances: Utterance[] = []) {
  await db().transaction('rw', db().sessions, db().utterances, async () => {
    await db().sessions.put(session);
    if (utterances.length) await db().utterances.bulkPut(utterances);
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  return db().transaction('r', db().sessions, db().utterances, async () => {
    const sessions = await db().sessions.orderBy('createdAt').reverse().toArray();
    return Promise.all(
      sessions.map(async (session) => {
        const first = await bySeq(session.id)
          .filter((u) => u.status === 'done' && !!u.translation)
          .first();
        const utteranceCount = await bySeq(session.id)
          .filter((u) => u.status !== 'skipped')
          .count();
        return { session, preview: first?.translation, utteranceCount };
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
