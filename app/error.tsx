'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { HomeButton, StatusScreen } from '@/components/StatusScreen';
import { Button } from '@/components/ui';

/**
 * Shown when a page crashes while rendering. Unmounting the page also runs its cleanup, so a
 * session that crashes releases the microphone. Saved lines stay on the device.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error('[app] page crashed', error);
  }, [error]);

  return (
    <StatusScreen
      icon={<TriangleAlert />}
      title="Something went wrong"
      actions={
        <>
          <HomeButton variant="secondary" />
          <Button className="flex-1" variant="primary" onClick={() => retry()}>
            Try again
          </Button>
        </>
      }
    >
      This page stopped working. Lines already transcribed are saved on this device.
    </StatusScreen>
  );
}
