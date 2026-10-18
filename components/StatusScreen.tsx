'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button, Card } from './ui';

/** A full-page notice (404, crash): an icon, a title, a line of help and actions. */
export function StatusScreen({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main className="flex flex-1 animate-fade-in items-center justify-center bg-canvas px-4 py-10">
      <Card className="flex w-full max-w-sm animate-scale-in flex-col items-center px-6 pt-8 pb-6 text-center shadow-lg!">
        <span
          aria-hidden
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-lavender text-accent-ink [&>svg]:h-7 [&>svg]:w-7"
        >
          {icon}
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</p>
        <div className="mt-6 flex w-full gap-2">{actions}</div>
      </Card>
    </main>
  );
}

/** Back to the home page; leaving the route also clears a crashed page's error boundary. */
export function HomeButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const router = useRouter();
  return (
    <Button className="flex-1" variant={variant} onClick={() => router.push('/')}>
      Go home
    </Button>
  );
}
