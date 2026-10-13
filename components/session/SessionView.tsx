'use client';

import { BookText, Mic } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { GlossaryDialog } from '../controls/GlossaryDialog';
import { LanguageMenu } from '../controls/LanguageMenu';
import { MicSettingsDialog } from '../controls/MicSettingsDialog';
import { RecordBar } from '../controls/RecordBar';
import { TranscriptList } from '../transcript/TranscriptList';
import { IconButton } from '../ui';
import { Banners } from './Banners';
import { SessionControllerProvider } from './controller-context';
import { MicErrorScreen } from './MicErrorScreen';
import { SessionHeader } from './SessionHeader';

function Toolbar() {
  const [dialog, setDialog] = useState<'glossary' | 'mic' | null>(null);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <LanguageMenu />
      <div className="flex-1" />
      <IconButton label="Glossary" onClick={() => setDialog('glossary')}>
        <BookText className="h-5 w-5" aria-hidden />
      </IconButton>
      <IconButton label="Microphone settings" onClick={() => setDialog('mic')}>
        <Mic className="h-5 w-5" aria-hidden />
      </IconButton>
      {dialog === 'glossary' && <GlossaryDialog open onClose={() => setDialog(null)} />}
      {dialog === 'mic' && <MicSettingsDialog open onClose={() => setDialog(null)} />}
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
