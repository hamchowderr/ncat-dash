import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shown where files are needed before the team has a working toolkit. Files go to the
 * toolkit's own storage, so the toolkit is the only thing to set up.
 */
export function NeedsToolkit({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-3 rounded-xl bg-surface p-5 ${className}`}>
      <p className="text-muted-foreground text-sm">
        Your files go to your toolkit&apos;s own storage. Connect your toolkit first, or check it
        again if it is already connected.
      </p>
      <Button asChild size="sm">
        <Link href="/">Go to your toolkit</Link>
      </Button>
    </div>
  );
}
