'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { deleteSession, listSessions, renameSession, type SessionSummary } from '@/lib/db/dexie';
import { formatDateTime, formatElapsed } from '@/lib/format';
import { Button, Dialog, IconButton } from '../ui';

function EditSessionDialog({
  item,
  onClose,
  onChanged,
}: {
  item: SessionSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(item.session.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    const clean = title.trim();
    if (clean && clean !== item.session.title) await renameSession(item.session.id, clean);
    onChanged();
    onClose();
  };
  const remove = async () => {
    await deleteSession(item.session.id);
    onChanged();
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={confirmDelete ? 'Delete session?' : 'Edit session'}
      footer={
        confirmDelete ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="bg-red-600 text-white" onClick={remove}>
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="mr-auto text-red-600"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </>
        )
      }
    >
      {confirmDelete ? (
        <p>
          “{item.session.title}” and its transcript will be removed from this device. This can’t be
          undone.
        </p>
      ) : (
        <>
          <label className="block text-sm font-medium" htmlFor="session-title">
            Title
          </label>
          <input
            id="session-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            maxLength={200}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-background px-3 text-base"
          />
        </>
      )}
    </Dialog>
  );
}

/** Sessions saved on this device, newest first. */
export function RecentSessions() {
  const [items, setItems] = useState<SessionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<SessionSummary | null>(null);

  const load = useCallback(() => {
    listSessions()
      .then(setItems)
      .catch((err) => {
        console.error('[db] list failed', err);
        setFailed(true);
      });
  }, []);

  useEffect(load, [load]);

  if (failed) {
    return (
      <p className="text-sm text-muted">
        Saved sessions aren’t available: this browser is blocking on-device storage.
      </p>
    );
  }
  if (!items) return null;
  if (items.length === 0) {
    return <p className="text-sm text-muted">Sessions you record are saved on this device.</p>;
  }

  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-2 text-sm font-medium text-muted">
        Recent sessions
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
        {items.map((item) => (
          <li
            key={item.session.id}
            data-testid="recent-session"
            className="flex items-center gap-1 pr-2"
          >
            <Link
              href={`/session/${item.session.id}`}
              className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-3 active:bg-subtle"
            >
              <span className="truncate font-medium">{item.session.title}</span>
              <span className="text-xs text-muted tabular-nums">
                {formatDateTime(item.session.createdAt)} ·{' '}
                {formatElapsed(item.session.durationMs ?? 0)} · {item.utteranceCount} lines
              </span>
              {item.preview && <span className="truncate text-sm text-muted">{item.preview}</span>}
            </Link>
            <IconButton
              label={`Edit ${item.session.title}`}
              className="border-transparent"
              onClick={() => setEditing(item)}
            >
              <Ellipsis className="h-5 w-5" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing && (
        <EditSessionDialog item={editing} onClose={() => setEditing(null)} onChanged={load} />
      )}
    </section>
  );
}
