'use client';

import { MicOff } from 'lucide-react';
import { useSessionStore } from '@/lib/store/session-store';
import { Button } from '../ui';
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
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center"
      role="alertdialog"
      aria-labelledby="mic-error-title"
    >
      <MicOff className="h-12 w-12 text-muted" aria-hidden />
      <h2 id="mic-error-title" className="text-xl font-semibold">
        {error.message}
      </h2>
      <p className="max-w-sm text-muted">{help(error.kind)}</p>
      <div className="flex gap-2">
        <Button onClick={() => setRecorder('idle')}>Close</Button>
        <Button variant="primary" onClick={() => void controller.start()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
