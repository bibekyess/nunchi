'use client';

import { CircleAlert, CircleCheck, Laptop, Link, Loader2, Server } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkEndpoint, type EndpointCheck } from '@/lib/engines/endpoint-check';
import { BUILT_ENGINES, ENGINE_LABELS } from '@/lib/engines/registry';
import {
  ENGINE_IDS,
  ENGINE_TASKS,
  isLocked,
  type EngineId,
  type EngineTask,
} from '@/lib/engines/types';
import { useEngineStatuses } from '@/lib/engines/use-engine-status';
import {
  cleanBaseUrl,
  DEFAULT_ENGINE_CHOICE,
  endpointChanged,
  endpointIssues,
  sanitizeEndpoint,
  type EndpointConfig,
  type EndpointIssue,
  type EndpointSettings,
  type EngineSettings,
} from '@/lib/settings/engine-settings';
import { useEngineSettings } from '@/lib/settings/use-engine-settings';
import { EngineStatusBadge } from '../EngineStatusBadge';
import { PasscodeForm } from '../PasscodeForm';
import { Badge, Button, cx, Dialog, SegmentedControl, Switch, type SegmentOption } from '../ui';
import { EndpointFields } from './EndpointFields';

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

/**
 * Which endpoint config a task's fields edit: the summary edits the translation endpoint while
 * it borrows it, which is also what it will use.
 */
function editedEndpoint(
  endpoints: EndpointSettings,
  task: EngineTask,
): 'speech' | 'translate' | 'summary' {
  return task === 'summary' && endpoints.summary.sameAsTranslate ? 'translate' : task;
}

/** Where each task runs: the app's server, a custom endpoint, or this device. */
export function ProcessingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const savedChoice = useEngineSettings((s) => s.choice);
  const savedEndpoints = useEngineSettings((s) => s.endpoints);
  const setSettings = useEngineSettings((s) => s.setSettings);
  const [draft, setDraft] = useState<EngineSettings>({
    choice: savedChoice,
    endpoints: savedEndpoints,
  });
  const [showProblems, setShowProblems] = useState(false);
  // Only saved endpoints are checked in the background: an edited one may be a half-typed URL,
  // and the check would send it the API key. Test connection checks edits on request.
  const selected = useEngineStatuses(draft.choice, savedEndpoints);
  // The server's own status per task tells whether it can be picked at all.
  const server = useEngineStatuses(DEFAULT_ENGINE_CHOICE, savedEndpoints);

  const { choice, endpoints } = draft;
  // One passcode unlocks the server for every task, so it is asked once, above them.
  const askPasscode =
    ENGINE_TASKS.some((t) => isLocked(server[t])) &&
    ENGINE_TASKS.some((t) => choice[t] === 'server');

  /** What blocks saving a task's custom endpoint (none unless the task uses one). */
  const issuesFor = (task: EngineTask): EndpointIssue[] =>
    choice[task] === 'endpoint' ? endpointIssues(endpoints[editedEndpoint(endpoints, task)]) : [];

  const options = (task: EngineTask): SegmentOption<EngineId>[] =>
    ENGINE_IDS.map((id) => {
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

  const [checks, setChecks] = useState<
    Partial<Record<keyof EndpointSettings, EndpointCheck | 'pending'>>
  >({});
  const checkAbort = useRef<Partial<Record<keyof EndpointSettings, AbortController>>>({});
  useEffect(() => {
    const running = checkAbort.current;
    return () => Object.values(running).forEach((a) => a?.abort());
  }, []);

  const setEndpoint = (key: keyof EndpointSettings, config: EndpointConfig) => {
    setDraft((d) => ({
      ...d,
      endpoints: { ...d.endpoints, [key]: { ...d.endpoints[key], ...config } },
    }));
    // A result no longer describes what's in the form; keep the model list for suggestions.
    setChecks((c) => {
      const prev = c[key];
      if (!prev || prev === 'pending') return c;
      return { ...c, [key]: { ok: false, message: '', models: prev.models } };
    });
  };

  const test = async (key: keyof EndpointSettings) => {
    checkAbort.current[key]?.abort();
    const abort = new AbortController();
    checkAbort.current[key] = abort;
    setChecks((c) => ({ ...c, [key]: 'pending' }));
    try {
      const result = await checkEndpoint(
        sanitizeEndpoint(endpoints[key]),
        key === 'speech' ? 'speech' : 'chat',
        { pageProtocol: location.protocol, signal: abort.signal },
      );
      if (!abort.signal.aborted) setChecks((c) => ({ ...c, [key]: result }));
    } catch {
      if (!abort.signal.aborted) {
        setChecks((c) => ({
          ...c,
          [key]: { ok: false, message: 'The test failed unexpectedly.' },
        }));
      }
    }
  };

  const save = () => {
    if (ENGINE_TASKS.some((task) => issuesFor(task).length > 0)) {
      setShowProblems(true);
      return;
    }
    setSettings(draft);
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

      {askPasscode && (
        <div className="mt-5 animate-fade-in rounded-2xl bg-surface-2 p-3.5">
          <PasscodeForm id="processing-passcode" label="Server passcode" className="text-sm" />
          <p className="mt-2 text-sm text-ink-muted">
            Unlocks Server for every task. No passcode? Choose Custom instead.
          </p>
        </div>
      )}

      {TASKS.map(({ task, title, hint }) => {
        const engine = choice[task];
        const notSetUp = engine === 'server' && server[task]?.state === 'not_configured';
        const custom = engine === 'endpoint';
        // The summary can share the translation endpoint only while translation uses one.
        const canShare = task === 'summary' && choice.translate === 'endpoint';
        const sharing = canShare && endpoints.summary.sameAsTranslate;
        const key = editedEndpoint(endpoints, task);
        return (
          <section key={task} className="mt-6">
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-sm text-ink-muted">{hint}</p>
              </div>
              {custom && endpointChanged(endpoints, savedEndpoints, task) ? (
                <Badge dot title="Saved settings are checked. Use Test connection for these.">
                  Not checked
                </Badge>
              ) : (
                <EngineStatusBadge status={selected[task]} />
              )}
            </div>
            <SegmentedControl
              label={title}
              value={engine}
              onChange={(id) => setDraft((d) => ({ ...d, choice: { ...d.choice, [task]: id } }))}
              options={options(task)}
              variant="soft"
              tone="accent"
              stretch
            />
            {(notSetUp || !BUILT_ENGINES.has(engine)) && (
              <p className="mt-2 animate-fade-in text-sm text-warn-ink" role="note">
                {engine === 'server'
                  ? 'This server has no model for this task.'
                  : `${ENGINE_LABELS[engine]} isn't available yet, so this task won't run. Choose Server.`}
              </p>
            )}
            {custom && canShare && (
              <Switch
                className="mt-3"
                label="Same as translation"
                description={sharing ? 'Uses the translation server and model above.' : undefined}
                checked={endpoints.summary.sameAsTranslate}
                onChange={(sameAsTranslate) =>
                  setDraft((d) => ({
                    ...d,
                    endpoints: {
                      ...d.endpoints,
                      summary: {
                        ...d.endpoints.summary,
                        sameAsTranslate,
                        // Start from the translation endpoint when splitting off.
                        ...(sameAsTranslate ? {} : d.endpoints.translate),
                      },
                    },
                  }))
                }
              />
            )}
            {custom && !sharing && (
              <EndpointFields
                task={task}
                value={endpoints[key]}
                onChange={(config) => setEndpoint(key, config)}
                issues={issuesFor(task)}
                showProblem={showProblems}
                models={(() => {
                  const c = checks[key];
                  return c && c !== 'pending' ? c.models : undefined;
                })()}
              >
                <TestConnection
                  check={checks[key]}
                  disabled={!cleanBaseUrl(endpoints[key].baseUrl)}
                  onTest={() => void test(key)}
                />
              </EndpointFields>
            )}
            {custom && sharing && showProblems && issuesFor(task).length > 0 && (
              <p className="mt-2 text-sm text-danger-ink" role="alert">
                Set up the translation endpoint above.
              </p>
            )}
          </section>
        );
      })}

      <p className="mt-6 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-muted">
        Custom calls your own OpenAI-compatible server (e.g. Speaches, Ollama, LM Studio) straight
        from this browser. On-device models are coming soon.
      </p>
    </Dialog>
  );
}

/** The Test connection button and its result. */
function TestConnection({
  check,
  disabled,
  onTest,
}: {
  check: EndpointCheck | 'pending' | undefined;
  disabled: boolean;
  onTest: () => void;
}) {
  const pending = check === 'pending';
  const result = check && check !== 'pending' && check.message ? check : null;
  return (
    <div className="mt-3.5">
      <Button size="sm" onClick={onTest} disabled={disabled || pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      <div role="status" aria-live="polite">
        {result && (
          <div
            className={cx(
              'mt-3 flex animate-fade-in items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
              result.ok ? 'bg-ok-soft text-ok-ink' : 'bg-danger-soft text-danger-ink',
            )}
          >
            {result.ok ? (
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 break-words">
              <p>{result.message}</p>
              {result.ok && result.warning && <p className="mt-1 opacity-80">{result.warning}</p>}
              {!result.ok && result.hint && <p className="mt-1 opacity-80">{result.hint}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
