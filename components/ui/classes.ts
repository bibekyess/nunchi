export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/** Shared interaction states: color/shadow/transform transitions, a press dip and disabled. */
export const PRESSABLE =
  'transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';
