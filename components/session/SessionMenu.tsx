'use client';

import { BookText, Cpu, Ellipsis, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { AudioSettingsDialog } from '../controls/AudioSettingsDialog';
import { GlossaryDialog } from '../controls/GlossaryDialog';
import { ProcessingDialog } from '../controls/ProcessingDialog';
import { ThemeMenuItems } from '../ThemeToggle';
import { IconButton, Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui';

type DialogId = 'glossary' | 'audio' | 'processing';

/** Header overflow menu: session settings and the theme. */
export function SessionMenu() {
  const [dialog, setDialog] = useState<DialogId | null>(null);

  return (
    <>
      <Menu
        label="More"
        trigger={(p) => (
          <IconButton label="More" variant="ghost" {...p}>
            <Ellipsis className="h-5 w-5" aria-hidden />
          </IconButton>
        )}
      >
        <MenuItem icon={<BookText />} onSelect={() => setDialog('glossary')}>
          Glossary
        </MenuItem>
        <MenuItem icon={<SlidersHorizontal />} onSelect={() => setDialog('audio')}>
          Audio settings
        </MenuItem>
        <MenuItem icon={<Cpu />} onSelect={() => setDialog('processing')}>
          Processing
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <ThemeMenuItems />
      </Menu>
      {dialog === 'glossary' && <GlossaryDialog open onClose={() => setDialog(null)} />}
      {dialog === 'audio' && <AudioSettingsDialog open onClose={() => setDialog(null)} />}
      {dialog === 'processing' && <ProcessingDialog open onClose={() => setDialog(null)} />}
    </>
  );
}
