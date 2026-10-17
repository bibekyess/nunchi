'use client';

import { Laptop, Link, Server } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BUILT_ENGINES, ENGINE_LABELS } from '@/lib/engines/registry';
import type { EngineId, EngineTask } from '@/lib/engines/types';
import { useEngineStatuses } from '@/lib/engines/use-engine-status';
import {
  DEFAULT_ENGINE_CHOICE,
  useEngineSettings,
  type EngineChoice,
} from '@/lib/settings/engines';
import { EngineStatusBadge } from '../EngineStatusBadge';
import { Button, Dialog, SegmentedControl, type SegmentOption } from '../ui';

// Icons drop out on the narrowest phones so the three labels still fit on one row.
const ICON = 'h-4 w-4 max-[400px]:hidden';
const ENGINE_ICONS: Record<EngineId, ReactNode> = {
  server: <Server className={ICON} aria-hidden />,
  endpoint: <Link className={ICON} aria-hidden />,
  device: <Laptop className={ICON} aria-hidden />,
};

const TASKS: { task: EngineTask; title: string; hint: string }[] = [
  { task: 'speech', title: 'Speech to text', hint: 'Turns what people say into text.' },
  { task: 'translate', title: 'Translation', hint: 'Translates each line as it arrives.' },
  { task: 'summary', title: 'Summary', hint: 'Writes the meeting summary.' },
];

const ENGINE_ORDER: EngineId[] = ['server', 'endpoint', 'device'];

/** Where each task runs: the app's server, a custom endpoint, or this device. */
export function ProcessingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useEngineSettings((s) => s.choice);
  const setChoice = useEngineSettings((s) => s.setChoice);
  const [draft, setDraft] = useState<EngineChoice>(saved);
  const selected = useEngineStatuses(draft);
  // The server's own status per task tells whether it can be picked at all.
  const server = useEngineStatuses(DEFAULT_ENGINE_CHOICE);

  const options = (task: EngineTask): SegmentOption<EngineId>[] =>
    ENGINE_ORDER.map((id) => {
      const notSetUp = id === 'server' && server[task]?.state === 'not_configured';
      const built = BUILT_ENGINES.has(id);
      return {
        value: id,
        label: ENGINE_LABELS[id],
        icon: ENGINE_ICONS[id],
        disabled: !built || notSetUp,
        hint: !built ? 'Coming soon' : notSetUp ? 'Not configured on this server' : undefined,
      };
    });

  const save = () => {
    setChoice(draft);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Processing"
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
      <p className="text-sm text-ink-muted">
        Choose where each task runs. Saved on this device; changes apply from the next line.
      </p>

      {TASKS.map(({ task, title, hint }) => {
        const unavailable =
          (draft[task] === 'server' && server[task]?.state === 'not_configured') ||
          !BUILT_ENGINES.has(draft[task]);
        return (
          <section key={task} className="mt-6">
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-sm text-ink-muted">{hint}</p>
              </div>
              <EngineStatusBadge status={selected[task]} />
            </div>
            <SegmentedControl
              label={title}
              value={draft[task]}
              onChange={(id) => setDraft((d) => ({ ...d, [task]: id }))}
              options={options(task)}
              variant="soft"
              tone="accent"
              stretch
            />
            {unavailable && (
              <p className="mt-2 animate-fade-in text-sm text-warn-ink" role="note">
                {draft[task] === 'server'
                  ? 'This server has no model for this task.'
                  : `${ENGINE_LABELS[draft[task]]} isn't available yet, so this task won't run. Choose Server.`}
              </p>
            )}
          </section>
        );
      })}

      <p className="mt-6 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-muted">
        Custom endpoints (your own OpenAI-compatible server) and on-device models are coming soon.
      </p>
    </Dialog>
  );
}
