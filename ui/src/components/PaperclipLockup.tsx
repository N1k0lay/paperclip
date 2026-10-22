import type { SVGProps } from "react";

interface PaperclipLockupProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  decorative?: boolean;
  title?: string;
}

export const SKAZ_MARK_PATH = "M28 10a13 13 0 1 0 0 16M28 26l-1 6-6-2M23 14a7 7 0 1 0 0 8";

export function SkazMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true" {...props}>
      <path className="paperclip-thinking-icon-path" d={SKAZ_MARK_PATH} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PaperclipLockup({ decorative = false, title = "Сказ", className, ...rest }: PaperclipLockupProps) {
  return (
    <svg {...rest} className={className} viewBox="0 0 116 36" fill="none"
      role={decorative ? undefined : "img"} aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title} focusable="false">
      <path d={SKAZ_MARK_PATH} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="43" y="27" fill="currentColor" className="text-2xl font-semibold">Сказ</text>
    </svg>
  );
}
