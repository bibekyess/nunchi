'use client';

import { useParams } from 'next/navigation';
import { selectColumns, useDisplayStore } from '@/lib/store/display-store';
import { LayoutToggle, TextSizeButton } from '../controls/DisplayButtons';
import { LanguageMenu } from '../controls/LanguageMenu';
import { RecordBar } from '../controls/RecordBar';
import { ViewFilterMenu } from '../controls/ViewFilterMenu';
import { TranscriptList } from '../transcript/TranscriptList';
import { cx } from '../ui';
import { Banners } from './Banners';
import { SessionControllerProvider } from './controller-context';
import { MicErrorScreen } from './MicErrorScreen';
import { SessionHeader } from './SessionHeader';

/** Cuckoo-style toolbar: what to show on the left, reading controls on the right. */
function Toolbar() {
  const columns = useDisplayStore(selectColumns);
  return (
    <div
      className={cx(
        'mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2',
        columns && 'md:max-w-5xl',
      )}
    >
      <ViewFilterMenu />
      <LayoutToggle />
      <div className="flex-1" />
      <LanguageMenu />
      <TextSizeButton />
    </div>
  );
}

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  return (
    <SessionControllerProvider sessionId={id}>
      <div className="relative flex h-dvh flex-col">
        <SessionHeader />
        <Toolbar />
        <Banners />
        <TranscriptList />
        <RecordBar />
        <MicErrorScreen />
      </div>
    </SessionControllerProvider>
  );
}
