import { Loader2Icon } from "lucide-react";

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <Loader2Icon className="text-muted-foreground size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
