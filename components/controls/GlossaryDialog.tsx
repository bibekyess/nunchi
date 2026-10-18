'use client';

import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSessionStore } from '@/lib/session/store';
import type { GlossaryEntry } from '@/lib/types';
import { Button, Dialog, IconButton, Input, Textarea } from '../ui';

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
      <Textarea
        id="meeting-context"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="e.g. AI Tinkerers Seoul meetup, sponsor Kiro from AWS"
        className="mt-1.5 min-h-20"
      />

      <p className="mt-6 text-sm font-medium">Names and terms</p>
      <p className="text-sm text-ink-muted">
        Helps spell names correctly. Translation is optional.
      </p>
      <ul className="mt-3 flex flex-col gap-3 sm:gap-2">
        {rows.map((row, i) => (
          <li key={i} className="flex animate-fade-in items-center gap-2">
            {/* Stacked on phones so the placeholders fit; side by side from sm up. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              <Input
                value={row.term}
                onChange={(e) => update(i, { term: e.target.value })}
                placeholder="As spoken (키로)"
                aria-label={`Term ${i + 1}`}
                maxLength={100}
                className="min-w-0 flex-1"
              />
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint max-sm:hidden" aria-hidden />
              <Input
                value={row.translation ?? ''}
                onChange={(e) => update(i, { translation: e.target.value })}
                placeholder="Translation (Kiro)"
                aria-label={`Translation ${i + 1}`}
                maxLength={200}
                className="min-w-0 flex-1"
              />
            </div>
            <IconButton
              label={`Remove term ${i + 1}`}
              variant="ghost"
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              className="-mr-1.5 enabled:hover:bg-danger-soft enabled:hover:[&>svg]:text-danger-ink"
            >
              <Trash2 className="h-4 w-4 text-ink-muted transition-colors" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button
        variant="accent"
        className="mt-3"
        onClick={() => setRows((r) => [...r, { term: '', translation: '' }])}
      >
        <Plus className="h-4 w-4" aria-hidden /> Add term
      </Button>
    </Dialog>
  );
}
