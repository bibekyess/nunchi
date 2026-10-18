'use client';

import { ArrowRight, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { ENGINE_TASKS, isLocked } from '@/lib/engines/types';
import { useEngineStatuses } from '@/lib/engines/use-engine-status';
import { useEndpointSettings, useEngineChoice } from '@/lib/settings/use-engine-settings';
import { ProcessingDialog } from '../controls/ProcessingDialog';
import { PasscodeForm } from '../PasscodeForm';
import { Card } from '../ui';

/** The home page's passcode field; the locked health badge focuses it. */
export const UNLOCK_INPUT_ID = 'unlock-passcode';

/**
 * Asks for the server passcode before a session is started, when a task set to the app's
 * servers is locked, and offers the way around it: your own servers in Processing.
 */
export function UnlockCard() {
  const choice = useEngineChoice();
  const statuses = useEngineStatuses(choice, useEndpointSettings());
  const [processing, setProcessing] = useState(false);
  const locked = ENGINE_TASKS.some((t) => isLocked(statuses[t]));

  return (
    <>
      {locked && (
        <Card className="mb-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
              <KeyRound className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <PasscodeForm
                id={UNLOCK_INPUT_ID}
                label="This app's servers need a passcode."
                className="text-sm"
              />
              <button
                type="button"
                onClick={() => setProcessing(true)}
                className="mt-3 inline-flex items-center gap-1 rounded-md text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
              >
                No passcode? Use your own servers
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </Card>
      )}
      {processing && <ProcessingDialog open onClose={() => setProcessing(false)} />}
    </>
  );
}
