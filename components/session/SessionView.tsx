'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { selectColumns, useDisplayStore } from '@/lib/store/display-store';
import { LayoutToggle, TextSizeButton } from '../controls/DisplayButtons';
import { LanguageMenu } from '../controls/LanguageMenu';
import { RecordBar } from '../controls/RecordBar';
import { ViewFilterMenu } from '../controls/ViewFilterMenu';
import { SummaryPanel } from '../summary/SummaryPanel';
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

const TABS = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'summary', label: 'Summary' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Tabs({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <div role="tablist" className="mx-auto flex w-full max-w-3xl gap-1 px-3 pt-2">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-controls={`panel-${id}`}
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={cx(
            'min-h-11 rounded-full px-4 text-sm font-medium transition-colors',
            tab === id ? 'bg-foreground text-background' : 'text-muted active:bg-subtle',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabId>('transcript');
  return (
    <SessionControllerProvider sessionId={id}>
      <div className="relative flex h-dvh flex-col">
        <SessionHeader />
        <Tabs tab={tab} onChange={setTab} />
        <Banners />
        {/* Both panels stay mounted: the transcript keeps its scroll position and a summary
            keeps streaming while the other tab is shown. */}
        <div
          role="tabpanel"
          id="panel-transcript"
          aria-labelledby="tab-transcript"
          className={cx('min-h-0 flex-1 flex-col', tab === 'transcript' ? 'flex' : 'hidden')}
        >
          <Toolbar />
          <TranscriptList />
        </div>
        <div
          role="tabpanel"
          id="panel-summary"
          aria-labelledby="tab-summary"
          className={cx('min-h-0 flex-1 flex-col', tab === 'summary' ? 'flex' : 'hidden')}
        >
          <SummaryPanel />
        </div>
        <RecordBar />
        <MicErrorScreen />
      </div>
    </SessionControllerProvider>
  );
}
