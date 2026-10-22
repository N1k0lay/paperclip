import type { SVGProps } from "react";
import { cn } from "../lib/utils";
import { SkazMark } from "./PaperclipLockup";

export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <SkazMark
      className={cn("paperclip-thinking-icon", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Shared full-page loading state. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedPaperclipIcon className="h-24 w-24 text-muted-foreground" />
      <span className="sr-only">Загрузка…</span>
    </div>
  );
}
