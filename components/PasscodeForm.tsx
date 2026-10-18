'use client';

import { Loader2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { unlockServer, type UnlockResult } from '@/lib/engines/server';
import { Button, cx, Input } from './ui';

const ERRORS: Record<Exclude<UnlockResult, 'ok'>, string> = {
  wrong: "That passcode didn't work.",
  unreachable: "Couldn't reach the server. Try again.",
};

/**
 * The app server's passcode, checked before it is kept: a wrong one is reported here rather
 * than by the next failed line. Used on the home page, in Processing and in the session banner.
 */
export function PasscodeForm({
  id,
  label,
  inline = false,
  onUnlocked,
  className,
}: {
  id: string;
  label: ReactNode;
  /** Label beside the field (banner) instead of above it. */
  inline?: boolean;
  onUnlocked?: () => void;
  className?: string;
}) {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value || pending) return;
    setPending(true);
    setError(null);
    const result = await unlockServer(value);
    setPending(false);
    if (result === 'ok') {
      setToken('');
      onUnlocked?.();
    } else {
      setError(ERRORS[result]);
    }
  };

  return (
    <form
      className={cx('flex flex-wrap items-center gap-x-3 gap-y-2', className)}
      onSubmit={(e) => void submit(e)}
    >
      <label htmlFor={id} className={cx('font-medium', !inline && 'basis-full')}>
        {label}
      </label>
      <div className="flex min-w-0 flex-1 basis-56 gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={pending || !token.trim()}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Unlock
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="basis-full text-sm text-danger-ink">
          {error}
        </p>
      )}
    </form>
  );
}
