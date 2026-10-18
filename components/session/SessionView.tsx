'use client';

import { AudioLines, Sparkles } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { selectColumns, useDisplayStore } from '@/lib/display/store';
import { LayoutToggle, TextSizeButton } from '../controls/DisplayButtons';
import { LanguageMenu } from '../controls/LanguageMenu';
import { RecordBar } from '../controls/RecordBar';
import { ViewFilterMenu } from '../controls/ViewFilterMenu';
import { SummaryPanel } from '../summary/SummaryPanel';
import { TranscriptList } from '../transcript/TranscriptList';
import { cx, SegmentedControl, type SegmentOption } from '../ui';
import { Banners } from './Banners';
import { SessionControllerProvider } from './controller-context';
import { MicErrorScreen } from './MicErrorScreen';
import { SessionHeader } from './SessionHeader';

/** Cuckoo-style toolbar: what to show on the left, reading controls on the right. */
function Toolbar() {
  return (
    <div className="flex min-w-0 grow basis-full items-center gap-2 md:basis-0 md:pl-1">
      <ViewFilterMenu />
      <LayoutToggle />
      <div className="flex-1" />
      <LanguageMenu />
      <TextSizeButton />
    </div>
  );
}

type TabId = 'transcript' | 'summary';

const TAB_ICON = 'h-4 w-4';
const TABS: readonly SegmentOption<TabId>[] = [
  {
    value: 'transcript',
    label: 'Transcript',
    icon: <AudioLines className={TAB_ICON} aria-hidden />,
    id: 'tab-transcript',
    controls: 'panel-transcript',
  },
  {
    value: 'summary',
    label: 'Summary',
    icon: <Sparkles className={TAB_ICON} aria-hidden />,
    id: 'tab-summary',
    controls: 'panel-summary',
  },
];

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabId>('transcript');
  return (
    <SessionControllerProvider sessionId={id}>
      <SessionLayout tab={tab} onTab={setTab} />
    </SessionControllerProvider>
  );
}

/**
 * Content runs edge to edge and scrolls under the floating chrome: a glass top bar (header,
 * tabs, toolbar, banners) and the glass record dock. Panels pad by --top-inset (measured
 * here, so banners push content down) and --bottom-inset (the dock's fixed height).
 */
function SessionLayout({ tab, onTab }: { tab: TabId; onTab: (tab: TabId) => void }) {
  const columns = useDisplayStore(selectColumns);
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  // Written straight to a CSS variable, so a resize never re-renders the transcript.
  useLayoutEffect(() => {
    const el = top.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      root.current?.style.setProperty('--top-inset', `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = cx('mx-auto w-full max-w-3xl', columns && 'md:max-w-5xl');
  return (
    <div
      ref={root}
      className="relative h-dvh overflow-hidden [--bottom-inset:calc(max(0.75rem,env(safe-area-inset-bottom))+6rem)] [--top-inset:10rem]"
    >
      <div
        ref={top}
        className="glass-bar absolute inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]"
      >
        <div className={cx(width, 'px-2 md:px-3')}>
          <SessionHeader />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2.5">
            <SegmentedControl
              role="tablist"
              label="Session view"
              value={tab}
              onChange={onTab}
              options={TABS}
              variant="soft"
            />
            {tab === 'transcript' && <Toolbar />}
          </div>
          <Banners />
        </div>
      </div>

      {/* Both panels stay mounted: the transcript keeps its scroll position and a summary
          keeps streaming while the other tab is shown. */}
      <div
        role="tabpanel"
        id="panel-transcript"
        aria-labelledby="tab-transcript"
        className={cx('absolute inset-0 flex-col', tab === 'transcript' ? 'flex' : 'hidden')}
      >
        <TranscriptList />
      </div>
      <div
        role="tabpanel"
        id="panel-summary"
        aria-labelledby="tab-summary"
        className={cx('absolute inset-0 flex-col', tab === 'summary' ? 'flex' : 'hidden')}
      >
        <SummaryPanel />
      </div>
      <RecordBar />
      <MicErrorScreen />
    </div>
  );
}
