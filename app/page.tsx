import { HealthDot } from '@/components/HealthDot';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">nunchi</h1>
        <HealthDot />
      </header>
      <p className="text-muted">
        Live Korean ↔ English transcription and translation. Recording arrives in Phase 1.
      </p>
    </main>
  );
}
