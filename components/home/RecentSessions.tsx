'use client';

import { AudioLines, DatabaseZap, Ellipsis, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { deleteSession, listSessions, renameSession, type SessionSummary } from '@/lib/db/dexie';
import { DATE_GROUP_LABELS, formatDateTime, formatElapsed, groupByDate } from '@/lib/format';
import { Button, Dialog, IconButton, Input } from '../ui';
import { Logo } from '../Logo';

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
      size="sm"
      title={confirmDelete ? 'Delete session?' : 'Edit session'}
      footer={
        confirmDelete ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="mr-auto -ml-2 enabled:text-danger-ink enabled:hover:bg-danger-soft"
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
        <div className="flex animate-fade-in gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-ink"
          >
            <Trash2 className="h-4.5 w-4.5" />
          </span>
          <p className="pt-1 text-sm leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">“{item.session.title}”</span> and its transcript
            will be removed from this device. This can’t be undone.
          </p>
        </div>
      ) : (
        <div className="animate-fade-in">
          <label className="block text-sm font-medium" htmlFor="session-title">
            Title
          </label>
          <Input
            id="session-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            maxLength={200}
            className="mt-1.5"
          />
          <p className="mt-2 text-xs text-ink-muted tabular-nums">
            {formatDateTime(item.session.createdAt)} · {formatElapsed(item.session.durationMs ?? 0)}{' '}
            · {item.utteranceCount} lines
          </p>
        </div>
      )}
    </Dialog>
  );
}

/** A soft lavender disc with an icon, for the empty and unavailable states. */
function Illustration({ tone, children }: { tone: 'accent' | 'warn'; children: React.ReactNode }) {
  return (
    <div aria-hidden className="relative mb-4 flex h-20 w-20 items-center justify-center">
      <span
        className={
          tone === 'accent'
            ? 'absolute inset-0 animate-breathe rounded-full bg-lavender'
            : 'absolute inset-0 rounded-full bg-warn-soft'
        }
      />
      <span
        className={
          tone === 'accent'
            ? 'absolute inset-2.5 rounded-full bg-lavender-strong'
            : 'absolute inset-2.5 rounded-full bg-warn-soft'
        }
      />
      <span
        className={
          tone === 'accent'
            ? 'relative text-accent-ink [&>svg]:h-7 [&>svg]:w-7'
            : 'relative text-warn-ink [&>svg]:h-7 [&>svg]:w-7'
        }
      >
        {children}
      </span>
    </div>
  );
}

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'accent' | 'warn';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-10 text-center">
      <Illustration tone={tone}>{icon}</Illustration>
      <p className="font-semibold tracking-tight text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-ink-muted">{children}</p>
    </div>
  );
}

/** Sessions saved on this device, newest first, grouped by day. */
export function RecentSessions() {
  const [groups, setGroups] = useState<ReturnType<typeof groupByDate<SessionSummary>> | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<SessionSummary | null>(null);

  const load = useCallback(() => {
    listSessions()
      .then((list) => {
        // Grouped here, not during render: "today" depends on the clock.
        setGroups(groupByDate(list, (i) => i.session.createdAt));
      })
      .catch((err) => {
        console.error('[db] list failed', err);
        setFailed(true);
      });
  }, []);

  useEffect(load, [load]);

  if (failed) {
    return (
      <Notice tone="warn" icon={<DatabaseZap />} title="Storage unavailable">
        Saved sessions aren’t available: this browser is blocking on-device storage.
      </Notice>
    );
  }
  if (!groups) return null;
  if (groups.length === 0) {
    return (
      <Notice
        tone="accent"
        icon={<Logo variant="mark" alt="" className="h-16" />}
        title="No sessions yet"
      >
        Sessions you record are saved on this device.
      </Notice>
    );
  }

  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="text-lg font-bold tracking-tight text-ink">
        Recent sessions
      </h2>
      {groups.map(({ group, items: rows }, g) => {
        // Position of this group's first row in the whole list, for the entrance stagger.
        const start = groups.slice(0, g).reduce((n, prev) => n + prev.items.length, 0);
        return (
          <div key={group} className="mt-4">
            <h3 className="mb-2 px-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
              {DATE_GROUP_LABELS[group]}
            </h3>
            <ul className="flex flex-col gap-2">
              {rows.map((item, i) => (
                // Rows stagger in (capped, so long lists don't lag); the hover lift is on the
                // inner card so it doesn't fight the entrance animation's transform.
                <li
                  key={item.session.id}
                  data-testid="recent-session"
                  className="animate-slide-up-in"
                  style={{ animationDelay: `${Math.min(start + i, 8) * 40}ms` }}
                >
                  <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface pr-2 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
                    <Link
                      href={`/session/${item.session.id}`}
                      className="flex min-h-18 min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-3 active:opacity-80"
                    >
                      <span
                        aria-hidden
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lavender text-accent-ink"
                      >
                        <AudioLines className="h-5 w-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-semibold tracking-tight text-ink">
                          {item.session.title}
                        </span>
                        <span className="truncate text-xs text-ink-muted tabular-nums">
                          {formatDateTime(item.session.createdAt)} ·{' '}
                          {formatElapsed(item.session.durationMs ?? 0)} · {item.utteranceCount}{' '}
                          lines
                        </span>
                        {item.preview && (
                          <span className="truncate text-sm text-ink-muted">{item.preview}</span>
                        )}
                      </span>
                    </Link>
                    <IconButton
                      label={`Edit ${item.session.title}`}
                      variant="ghost"
                      onClick={() => setEditing(item)}
                    >
                      <Ellipsis className="h-5 w-5" aria-hidden />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {editing && (
        <EditSessionDialog item={editing} onClose={() => setEditing(null)} onChanged={load} />
      )}
    </section>
  );
}
