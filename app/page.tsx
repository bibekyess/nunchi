import { ArrowLeftRight } from 'lucide-react';
import { HealthDot } from '@/components/HealthDot';
import { RecentSessions } from '@/components/home/RecentSessions';
import { LangFlag } from '@/components/LangFlag';
import { Logo } from '@/components/Logo';
import { NewSessionButton } from '@/components/NewSessionButton';
import { ProcessingButton } from '@/components/home/ProcessingButton';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Entrance stagger: each block slides in a beat after the one above. */
const enter = (step: number) => ({ animationDelay: `${step * 60}ms` });

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] md:max-w-2xl md:px-6 md:pt-8">
      <header className="flex min-h-14 animate-fade-in items-center gap-2">
        <span className="flex flex-1 items-center">
          <Logo variant="horizontal" className="h-7" />
        </span>
        <HealthDot />
        <ProcessingButton />
        <ThemeToggle />
      </header>

      <section className="pt-10 pb-8 md:pt-20 md:pb-12">
        <h1
          className="animate-slide-up-in text-[2.75rem] leading-[1.02] font-bold tracking-[-0.035em] text-balance text-ink md:text-[4.25rem]"
          style={enter(1)}
        >
          Understand
          <br />
          every <span className="font-normal italic">meeting.</span>
        </h1>
        <p
          className="mt-4 max-w-md animate-slide-up-in text-base text-pretty text-ink-muted md:mt-5 md:text-lg"
          style={enter(2)}
        >
          Live Korean ↔ English transcription and translation for meetings.
        </p>
        <div
          aria-hidden
          className="mt-5 flex animate-slide-up-in items-center gap-2 text-sm font-medium text-ink"
          style={enter(3)}
        >
          <span className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1.5 shadow-sm">
            <LangFlag lang="ko" />
            한국어
          </span>
          <ArrowLeftRight className="h-4 w-4 text-ink-faint" />
          <span className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1.5 shadow-sm">
            <LangFlag lang="en" />
            English
          </span>
        </div>
      </section>

      <div className="animate-slide-up-in" style={enter(4)}>
        <NewSessionButton />
      </div>
      <div className="mt-10 animate-slide-up-in" style={enter(5)}>
        <RecentSessions />
      </div>
    </main>
  );
}
