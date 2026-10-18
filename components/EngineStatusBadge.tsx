'use client';

import type { EngineStatus } from '@/lib/engines/types';
import { Badge, type Tone } from './ui';

/** Short word and tone for an engine status; null means the check is still running. */
export function describeStatus(status: EngineStatus | null): { tone: Tone; text: string } {
  if (!status) return { tone: 'neutral', text: 'Checking…' };
  switch (status.state) {
    case 'ready':
      return { tone: 'ok', text: 'Ready' };
    case 'not_configured':
      return { tone: 'warn', text: 'Not set up' };
    case 'unavailable':
      return { tone: 'neutral', text: status.reason.replace(/\.$/, '') };
    case 'error':
      return status.needsPasscode
        ? { tone: 'warn', text: 'Passcode needed' }
        : { tone: 'danger', text: 'Down' };
  }
}

export function EngineStatusBadge({ status }: { status: EngineStatus | null }) {
  const { tone, text } = describeStatus(status);
  const title = status && 'reason' in status ? status.reason : undefined;
  return (
    <Badge tone={tone} dot pulse={!status} title={title}>
      {text}
    </Badge>
  );
}
