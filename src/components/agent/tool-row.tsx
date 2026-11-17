import { Check, CircleAlert } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

import { resultWords, toolWords } from "./tool-words";

/**
 * One thing the agent did, as a line of plain words with short facts under it. Shown in
 * place of the tool's name and raw input and output.
 */
export function ToolRow({
  call,
  result,
}: {
  call: { name: string; args: unknown };
  result: { result?: unknown; isError?: boolean } | undefined;
}) {
  const words = toolWords(call.name, call.args);
  if (!words) return undefined;
  const failed = result?.isError === true;
  const facts = result && !failed ? resultWords(call.name, result.result) : [];
  return (
    <div className="rounded-md bg-surface px-3 py-2 text-sm" data-tool={call.name}>
      <div className="flex items-center gap-2">
        {!result ? (
          <Spinner className="text-muted-foreground size-4" />
        ) : failed ? (
          <CircleAlert className="text-destructive size-4" aria-hidden="true" />
        ) : (
          <Check className="text-muted-foreground size-4" aria-hidden="true" />
        )}
        <span className="font-medium">{words.title}</span>
      </div>
      {failed && (
        <p className="text-muted-foreground mt-1">
          {typeof result?.result === "string" ? result.result : "That did not work."}
        </p>
      )}
      {facts.length > 0 && (
        <ul className="text-muted-foreground mt-1 space-y-0.5">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
