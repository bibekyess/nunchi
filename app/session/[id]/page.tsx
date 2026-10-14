import { Suspense } from 'react';
import { SessionView } from '@/components/session/SessionView';

export default function SessionPage() {
  // SessionView reads the id with useParams; Suspense keeps that out of the static shell.
  return (
    <Suspense fallback={null}>
      <SessionView />
    </Suspense>
  );
}
