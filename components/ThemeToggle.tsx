'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/browser/theme';
import { MenuItem, SegmentedControl, type SegmentOption } from './ui';

const ICON = 'h-4 w-4';

const OPTIONS: readonly SegmentOption<Theme>[] = [
  { value: 'light', label: 'Light', icon: <Sun className={ICON} aria-hidden />, iconOnly: true },
  { value: 'dark', label: 'Dark', icon: <Moon className={ICON} aria-hidden />, iconOnly: true },
];

/** Compact Light / Dark switch (icon-only radio group). */
export function ThemeToggle({
  variant = 'soft',
  className,
}: {
  variant?: 'glass' | 'soft';
  className?: string;
}) {
  const [theme, setTheme] = useTheme();
  return (
    <SegmentedControl
      label="Theme"
      value={theme}
      onChange={setTheme}
      options={OPTIONS}
      variant={variant}
      size="sm"
      className={className}
    />
  );
}

/** The same choice as radio rows, for use inside a <Menu>. */
export function ThemeMenuItems() {
  const [theme, setTheme] = useTheme();
  return (
    <>
      {OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          icon={o.icon}
          checked={theme === o.value}
          keepOpen
          onSelect={() => setTheme(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
    </>
  );
}
