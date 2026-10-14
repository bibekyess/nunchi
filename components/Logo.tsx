import Image from 'next/image';

const ART = {
  horizontal: { src: 'nunchi-horizontal', width: 1031, height: 232 },
  mark: { src: 'nunchi-mark-square', width: 512, height: 512 },
} as const;

/**
 * Brand art from public/nunchi-web-logo-kit. Both variants are rendered and CSS picks one,
 * so the app's theme toggle (not only the OS setting) decides; -dark is drawn for dark backgrounds.
 */
export function Logo({
  variant,
  alt = 'nunchi',
  className,
}: {
  variant: keyof typeof ART;
  alt?: string;
  className?: string;
}) {
  const { src, width, height } = ART[variant];
  const base = `/nunchi-web-logo-kit/${src}`;
  return (
    <>
      <Image
        src={`${base}.svg`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={`w-auto dark:hidden ${className ?? ''}`}
      />
      <Image
        src={`${base}-dark.svg`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={`hidden w-auto dark:block ${className ?? ''}`}
      />
    </>
  );
}
