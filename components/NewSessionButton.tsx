'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function NewSessionButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/session/${crypto.randomUUID()}`)}
      className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-lg font-semibold text-background active:opacity-80"
    >
      <Plus aria-hidden className="h-6 w-6" />
      New session
    </button>
  );
}
