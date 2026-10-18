'use client';

import { MicOff } from 'lucide-react';
import { useSessionStore } from '@/lib/session/store';
import { Button, Card } from '../ui';
import { useController } from './controller-context';

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function help(kind: string): string {
  switch (kind) {
    case 'denied':
      return isIOS()
        ? 'Allow the microphone in Settings → Safari → Microphone (or tap “aA” in the address bar → Website Settings), then try again.'
        : 'Allow the microphone for this site from the lock icon in the address bar, then try again.';
    case 'no-device':
      return 'Connect a microphone, or close other apps that are using it, then try again.';
    case 'insecure':
      return 'Open nunchi over HTTPS. Browsers only allow the microphone on secure pages.';
    case 'no-tab-audio':
      return 'In the share window, pick a tab and turn on “Also share tab audio”. To capture the whole computer, share the entire screen with “Also share system audio” (Windows and ChromeOS).';
    case 'unsupported':
      return 'Use a recent version of Safari, Chrome, Edge or Firefox.';
    default:
      return 'Reload the page and try again. If it keeps happening, try another browser.';
  }
}

export function MicErrorScreen() {
  const controller = useController();
  const error = useSessionStore((s) => s.recorderError);
  const setRecorder = useSessionStore((s) => s.setRecorder);
  if (!error) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex animate-fade-in items-center justify-center bg-canvas px-4"
      role="alertdialog"
      aria-labelledby="mic-error-title"
    >
      <Card className="flex w-full max-w-sm animate-scale-in flex-col items-center px-6 pt-8 pb-6 text-center shadow-lg!">
        <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft text-danger-ink">
          <MicOff className="h-7 w-7" aria-hidden />
        </span>
        <h2 id="mic-error-title" className="text-xl font-semibold tracking-tight">
          {error.message}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{help(error.kind)}</p>
        <div className="mt-6 flex w-full gap-2">
          <Button className="flex-1" onClick={() => setRecorder('idle')}>
            Close
          </Button>
          <Button className="flex-1" variant="primary" onClick={() => void controller.start()}>
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
