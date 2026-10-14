'use client';

import { ArrowRight, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function NewSessionButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/session/${crypto.randomUUID()}`)}
      className="group relative isolate flex min-h-20 w-full items-center gap-4 overflow-hidden rounded-3xl bg-ink py-4 pr-5 pl-4 text-left text-surface shadow-md transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.99]"
    >
      {/* Soft lavender glow in the corner; brightens on hover. */}
      <span
        aria-hidden
        className="absolute -top-16 -right-10 -z-10 h-44 w-44 rounded-full bg-accent opacity-35 blur-3xl transition-opacity duration-300 ease-out group-hover:opacity-55"
      />
      <span
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface/12 ring-1 ring-surface/15 transition-transform duration-200 ease-out group-hover:rotate-90"
      >
        <Plus className="h-6 w-6" strokeWidth={2.25} />
      </span>
      <span className="flex-1 text-lg font-bold tracking-tight">New session</span>
      <ArrowRight
        aria-hidden
        className="h-5 w-5 opacity-60 transition-[transform,opacity] duration-200 ease-out group-hover:translate-x-1 group-hover:opacity-100"
      />
    </button>
  );
}
