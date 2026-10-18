'use client';

import { ChevronDown, LockKeyhole } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { EngineTask } from '@/lib/engines/types';
import type { EndpointConfig, EndpointField, EndpointIssue } from '@/lib/settings/engine-settings';
import { Chip, cx, Input, Switch } from '../ui';

interface Preset {
  label: string;
  baseUrl: string;
}

/** Common local servers; picking one fills in its default URL. */
const PRESETS: Record<'speech' | 'chat', Preset[]> = {
  speech: [{ label: 'Speaches', baseUrl: 'http://localhost:8000/v1' }],
  chat: [
    { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
    { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  ],
};

const MODEL_PLACEHOLDER: Record<'speech' | 'chat', string> = {
  speech: 'Systran/faster-whisper-large-v3',
  chat: 'qwen3:4b',
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-3.5 first:mt-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * The URL, model and credentials of one custom endpoint. `issues` is what still blocks it
 * (shown as errors, with their fields marked, once `showProblem` is set); `models` fills the
 * model suggestions.
 */
export function EndpointFields({
  task,
  value,
  onChange,
  issues,
  showProblem,
  models,
  children,
}: {
  task: EngineTask;
  value: EndpointConfig;
  onChange: (next: EndpointConfig) => void;
  issues: EndpointIssue[];
  showProblem: boolean;
  models?: string[];
  /** Extra controls at the end (e.g. Test connection). */
  children?: ReactNode;
}) {
  const id = useId();
  const kind = task === 'speech' ? 'speech' : 'chat';
  const set = (patch: Partial<EndpointConfig>) => onChange({ ...value, ...patch });
  const invalid = showProblem && issues.length > 0;
  const marked = (field: EndpointField) =>
    (showProblem && issues.some((i) => i.field === field)) || undefined;

  return (
    <div className="mt-3 animate-fade-in rounded-2xl bg-surface-2 p-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-muted">Quick fill:</span>
        {PRESETS[kind].map((p) => (
          <Chip
            key={p.label}
            selected={value.baseUrl === p.baseUrl}
            onClick={() => set({ baseUrl: p.baseUrl })}
          >
            {p.label}
          </Chip>
        ))}
      </div>

      <Field id={`${id}-url`} label="Server URL">
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={PRESETS[kind][0].baseUrl}
          value={value.baseUrl}
          aria-invalid={marked('baseUrl')}
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
      </Field>

      <Field id={`${id}-model`} label="Model">
        <Input
          id={`${id}-model`}
          autoComplete="off"
          spellCheck={false}
          placeholder={MODEL_PLACEHOLDER[kind]}
          list={models?.length ? `${id}-models` : undefined}
          value={value.model}
          aria-invalid={marked('model')}
          onChange={(e) => set({ model: e.target.value })}
        />
        {models?.length ? (
          <datalist id={`${id}-models`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        ) : null}
      </Field>

      <Field
        id={`${id}-key`}
        label="API key (optional)"
        hint={
          <span className="inline-flex items-start gap-1.5">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Stored in this browser only, and sent only to this server.
          </span>
        }
      >
        <Input
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
        />
      </Field>

      <details className="group mt-3.5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
          More options
        </summary>
        <div className="mt-1 grid grid-cols-1 gap-x-3 min-[420px]:grid-cols-2">
          <Field id={`${id}-hname`} label="Custom header name">
            <Input
              id={`${id}-hname`}
              autoComplete="off"
              spellCheck={false}
              placeholder="x-api-key"
              value={value.headerName}
              aria-invalid={marked('headerName')}
              onChange={(e) => set({ headerName: e.target.value })}
            />
          </Field>
          <Field id={`${id}-hvalue`} label="Header value">
            <Input
              id={`${id}-hvalue`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value.headerValue}
              aria-invalid={marked('headerValue')}
              onChange={(e) => set({ headerValue: e.target.value })}
            />
          </Field>
        </div>
        {kind === 'chat' && (
          <Switch
            className="mt-3"
            label="Disable thinking (vLLM / Qwen)"
            description="Sends enable_thinking: false. Other servers ignore it."
            checked={value.disableThinking}
            onChange={(disableThinking) => set({ disableThinking })}
          />
        )}
      </details>

      {/* One thing to fix at a time; every field with an issue is marked above. */}
      {issues.length > 0 && (
        <p
          className={cx('mt-3 text-sm', invalid ? 'text-danger-ink' : 'text-ink-muted')}
          role={invalid ? 'alert' : undefined}
        >
          {issues[0].message}
        </p>
      )}
      {children}
    </div>
  );
}
