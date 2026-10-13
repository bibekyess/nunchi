'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSessionStore } from '@/lib/store/session-store';
import type { GlossaryEntry } from '@/lib/types';
import { Button, Dialog } from '../ui';

export function GlossaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted fresh each time it opens (see caller), so the draft starts from the session.
  const session = useSessionStore((s) => s.session);
  const setGlossary = useSessionStore((s) => s.setGlossary);
  const [rows, setRows] = useState<GlossaryEntry[]>(() =>
    session?.glossary.length ? session.glossary : [{ term: '', translation: '' }],
  );
  const [context, setContext] = useState(session?.meetingContext ?? '');

  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = () => {
    const clean = rows
      .map((r) => ({ term: r.term.trim(), translation: r.translation?.trim() || undefined }))
      .filter((r) => r.term);
    setGlossary(clean, context.trim() || undefined);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Glossary"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <label className="block text-sm font-medium" htmlFor="meeting-context">
        Meeting context
      </label>
      <textarea
        id="meeting-context"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="e.g. AI Tinkerers Seoul meetup, sponsor Kiro from AWS"
        className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base"
      />

      <p className="mt-4 text-sm font-medium">Names and terms</p>
      <p className="text-sm text-muted">Helps spell names correctly. Translation is optional.</p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={row.term}
              onChange={(e) => update(i, { term: e.target.value })}
              placeholder="As spoken (키로)"
              aria-label={`Term ${i + 1}`}
              maxLength={100}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-3 text-base"
            />
            <input
              value={row.translation ?? ''}
              onChange={(e) => update(i, { translation: e.target.value })}
              placeholder="Translation (Kiro)"
              aria-label={`Translation ${i + 1}`}
              maxLength={200}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-3 text-base"
            />
            <button
              type="button"
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              aria-label={`Remove term ${i + 1}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-subtle"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <Button
        className="mt-3"
        onClick={() => setRows((r) => [...r, { term: '', translation: '' }])}
      >
        <Plus className="h-4 w-4" aria-hidden /> Add term
      </Button>
    </Dialog>
  );
}
