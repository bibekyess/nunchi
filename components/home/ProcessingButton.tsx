'use client';

import { Cpu } from 'lucide-react';
import { useState } from 'react';
import { ProcessingDialog } from '../controls/ProcessingDialog';
import { IconButton } from '../ui';

/** Opens the Processing settings from the home page header. */
export function ProcessingButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Processing" variant="ghost" onClick={() => setOpen(true)}>
        <Cpu className="h-5 w-5" aria-hidden />
      </IconButton>
      {open && <ProcessingDialog open onClose={() => setOpen(false)} />}
    </>
  );
}
