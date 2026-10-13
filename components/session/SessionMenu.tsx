'use client';

import { BookText, Ellipsis, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AudioSettingsDialog } from '../controls/AudioSettingsDialog';
import { GlossaryDialog } from '../controls/GlossaryDialog';
import { IconButton } from '../ui';

const ITEMS = [
  { id: 'glossary', label: 'Glossary', Icon: BookText },
  { id: 'audio', label: 'Audio settings', Icon: SlidersHorizontal },
] as const;

type DialogId = (typeof ITEMS)[number]['id'];

/** Header overflow menu (the plan's "glossary, settings, export"; export arrives in Phase 3). */
export function SessionMenu() {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <IconButton
        label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="border-transparent"
      >
        <Ellipsis className="h-5 w-5" aria-hidden />
      </IconButton>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-xl border border-line bg-background py-1 shadow-lg"
        >
          {ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setDialog(id);
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm active:bg-subtle"
            >
              <Icon className="h-4 w-4 text-muted" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
      {dialog === 'glossary' && <GlossaryDialog open onClose={() => setDialog(null)} />}
      {dialog === 'audio' && <AudioSettingsDialog open onClose={() => setDialog(null)} />}
    </div>
  );
}
