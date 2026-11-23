"use client";

import type { ReactNode } from "react";
import type { SimpleIcon } from "simple-icons";
import { siClaude, siClaudecode } from "simple-icons";
import { toast } from "sonner";

import {
  OpenIn,
  OpenInContent,
  OpenInItem,
  OpenInLabel,
  OpenInSeparator,
  OpenInTrigger,
  providers,
} from "@/components/ai-elements/open-in-chat";

/**
 * The AI agents a toolkit prompt can go to: ones that can run commands, use connectors and
 * reach a server. The terminal ones get the prompt copied to paste once they start; Cursor
 * and ChatGPT open with it filled in; Claude's link stopped filling it in, so it is copied
 * first, then Claude opens.
 */
export type AiApp = {
  id: string;
  name: string;
  logo: ReactNode;
  /** Runs in a terminal: the prompt is copied, and this is the command that starts it. */
  command?: string;
  /** Opens with the prompt filled in. */
  withPrompt?: (prompt: string) => string;
  /** Opens empty; the prompt is copied first. */
  open?: string;
};

function Mark({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" fill={`#${icon.hex}`} aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

/** Codex's mark, which Simple Icons does not carry, from LobeHub's icon set (MIT). */
const CODEX = (
  <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true">
    <path
      clipRule="evenodd"
      d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
    />
  </svg>
);

export const AI_APPS: AiApp[] = [
  { id: "claude-code", name: "Claude Code", logo: <Mark icon={siClaudecode} />, command: "claude" },
  { id: "codex", name: "Codex", logo: CODEX, command: "codex" },
  {
    id: "cursor",
    name: "Cursor",
    logo: providers.cursor.icon,
    withPrompt: (p) => providers.cursor.createUrl(p),
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    logo: providers.chatgpt.icon,
    withPrompt: (p) => `https://chatgpt.com/?${new URLSearchParams({ q: p })}`,
  },
  { id: "claude", name: "Claude", logo: <Mark icon={siClaude} />, open: "https://claude.ai/new" },
];

const ICON = "[&_svg]:size-4 [&_svg]:shrink-0 [&>span]:flex";

/** "Open in", listing the AI agents that can do the setup, each with its own logo. */
export function OpenInAiApps({ prompt, trigger }: { prompt: string; trigger: ReactNode }) {
  async function copy(done: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(done);
    } catch {
      toast.error("Copy the prompt by hand: the browser did not allow it.");
    }
  }

  function copyThenOpen(app: AiApp) {
    // The tab opens first, while the click still counts, then the prompt is copied.
    window.open(app.open, "_blank", "noopener,noreferrer");
    void copy(`Prompt copied. Paste it into ${app.name}.`);
  }

  const item = (app: AiApp, hint?: ReactNode) => (
    <>
      <span aria-hidden="true">{app.logo}</span>
      <span className="flex-1">{app.name}</span>
      {hint}
    </>
  );

  return (
    <OpenIn query={prompt}>
      <OpenInTrigger>{trigger}</OpenInTrigger>
      <OpenInContent align="end" className="w-64">
        <OpenInLabel>Copies the prompt for your terminal</OpenInLabel>
        {AI_APPS.filter((app) => app.command).map((app) => (
          <OpenInItem
            key={app.id}
            className={`flex items-center gap-2 ${ICON}`}
            onSelect={() =>
              void copy(`Prompt copied. Run ${app.command} in a terminal and paste it.`)
            }
          >
            {item(
              app,
              <code aria-hidden="true" className="text-muted-foreground font-mono text-xs">
                {app.command}
              </code>,
            )}
          </OpenInItem>
        ))}
        <OpenInSeparator />
        <OpenInLabel>Opens with the prompt</OpenInLabel>
        {AI_APPS.filter((app) => app.withPrompt).map((app) => (
          <OpenInItem key={app.id} asChild>
            <a
              className={`flex items-center gap-2 ${ICON}`}
              href={app.withPrompt!(prompt)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item(app)}
            </a>
          </OpenInItem>
        ))}
        <OpenInSeparator />
        <OpenInLabel>Copies the prompt, then opens</OpenInLabel>
        {AI_APPS.filter((app) => app.open).map((app) => (
          <OpenInItem
            key={app.id}
            className={`flex items-center gap-2 ${ICON}`}
            onSelect={() => copyThenOpen(app)}
          >
            {item(app)}
          </OpenInItem>
        ))}
      </OpenInContent>
    </OpenIn>
  );
}
