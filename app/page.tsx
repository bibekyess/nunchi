import { HealthDot } from '@/components/HealthDot';
import { RecentSessions } from '@/components/home/RecentSessions';
import { NewSessionButton } from '@/components/NewSessionButton';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">nunchi</h1>
        <HealthDot />
      </header>
      <p className="text-muted">
        Live Korean ↔ English transcription and translation for meetings.
      </p>
      <NewSessionButton />
      <RecentSessions />
    </main>
  );
}
