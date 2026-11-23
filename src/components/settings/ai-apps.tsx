"use client";

import type { ReactNode } from "react";
import type { SimpleIcon } from "simple-icons";
import {
  siClaude,
  siDeepseek,
  siDuckduckgo,
  siGithubcopilot,
  siGooglegemini,
  siHuggingface,
  siKagi,
  siMistralai,
  siPerplexity,
} from "simple-icons";
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
 * Every AI app a prompt can go to. Most take the prompt in the address and open with it
 * filled in. The rest (Claude's link stopped filling it in, and the others never did) get it
 * copied first, then open, so it only needs pasting.
 */
export type AiApp = {
  id: string;
  name: string;
  logo: ReactNode;
  /** Opens with the prompt filled in. */
  withPrompt?: (prompt: string) => string;
  /** Opens empty; the prompt is copied first. */
  open?: string;
};

const q = (base: string, key: string, prompt: string, extra: Record<string, string> = {}) =>
  `${base}?${new URLSearchParams({ [key]: prompt, ...extra })}`;

function Mark({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" fill={`#${icon.hex}`} aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

/** Marks Simple Icons does not carry, from LobeHub's icon set (MIT). */
const GROK = (
  <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true">
    <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
  </svg>
);
const PHIND = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3.723 4.542V24H7.37v-7.893s.007 0 .007.007V15.6c1.249 1.201 2.818 2.034 4.555 2.319.418.062.844.097 1.276.097 4.325-.125 8.07-3.332 8.699-7.733a8.916 8.916 0 00-1.723-6.678A9.017 9.017 0 0014.228.092a9.023 9.023 0 00-6.71 1.715c-.238.173-.46.36-.677.555L4.288.321 2 3.153l1.723 1.389zM13 3.306a5.69 5.69 0 015.392 3.853 5.655 5.655 0 01-3.9 7.275 5.57 5.57 0 01-1.492.194c-.976 0-1.89-.243-2.692-.673a5.519 5.519 0 01-1.863-1.59 5.462 5.462 0 01-1.067-2.568 5.355 5.355 0 01-.063-.826c0-3.131 2.546-5.665 5.685-5.665z" />
  </svg>
);
const AI_STUDIO = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9.921 4.196H6.328A2.705 2.705 0 003.623 6.9v11.362a2.705 2.705 0 002.705 2.705h11.363a2.705 2.705 0 002.705-2.705v-4.756l1.623-1.113v5.87a4.329 4.329 0 01-4.328 4.328H6.328A4.329 4.329 0 012 18.263V6.901a4.328 4.328 0 014.328-4.329h4.545l-.952 1.624z" />
    <path d="M17.82 0c.145 0 .268.104.299.246a7 7 0 001.9 3.484 7 7 0 003.485 1.901c.142.031.246.154.246.3a.308.308 0 01-.246.298A7 7 0 0020.02 8.13a7 7 0 00-1.912 3.535.297.297 0 01-.288.238.297.297 0 01-.288-.238A7 7 0 0015.62 8.13a7 7 0 00-3.535-1.912.297.297 0 01-.238-.288c0-.14.1-.26.238-.288A7 7 0 0015.62 3.73 7.001 7.001 0 0017.521.246.308.308 0 0117.82 0z" />
  </svg>
);

export const AI_APPS: AiApp[] = [
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
    withPrompt: (p) => q("https://chatgpt.com/", "q", p),
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    logo: <Mark icon={siGithubcopilot} />,
    withPrompt: (p) => q("https://github.com/copilot", "prompt", p),
  },
  { id: "grok", name: "Grok", logo: GROK, withPrompt: (p) => q("https://grok.com/", "q", p) },
  {
    id: "perplexity",
    name: "Perplexity",
    logo: <Mark icon={siPerplexity} />,
    withPrompt: (p) => q("https://www.perplexity.ai/", "q", p),
  },
  {
    id: "ai-studio",
    name: "Google AI Studio",
    logo: AI_STUDIO,
    withPrompt: (p) => q("https://ai.studio/prompts/new_chat", "prompt", p),
  },
  {
    id: "kagi",
    name: "Kagi Assistant",
    logo: <Mark icon={siKagi} />,
    withPrompt: (p) => q("https://kagi.com/assistant", "q", p),
  },
  {
    id: "duckduckgo",
    name: "Duck.ai",
    logo: <Mark icon={siDuckduckgo} />,
    withPrompt: (p) => q("https://duckduckgo.com/", "q", p, { ia: "chat", duckai: "1" }),
  },
  { id: "v0", name: "v0", logo: providers.v0.icon, withPrompt: (p) => providers.v0.createUrl(p) },
  {
    id: "scira",
    name: "Scira",
    logo: providers.scira.icon,
    withPrompt: (p) => providers.scira.createUrl(p),
  },
  { id: "claude", name: "Claude", logo: <Mark icon={siClaude} />, open: "https://claude.ai/new" },
  {
    id: "gemini",
    name: "Gemini",
    logo: <Mark icon={siGooglegemini} />,
    open: "https://gemini.google.com/app",
  },
  {
    id: "le-chat",
    name: "Mistral Le Chat",
    logo: <Mark icon={siMistralai} />,
    open: "https://chat.mistral.ai/chat",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: <Mark icon={siDeepseek} />,
    open: "https://chat.deepseek.com/",
  },
  {
    id: "huggingchat",
    name: "HuggingChat",
    logo: <Mark icon={siHuggingface} />,
    open: "https://huggingface.co/chat/",
  },
  { id: "phind", name: "Phind", logo: PHIND, open: "https://www.phind.com/agent" },
];

const ICON = "[&_svg]:size-4 [&_svg]:shrink-0 [&>span]:flex";

/** "Open in", listing every AI app, each with its own logo. */
export function OpenInAiApps({ prompt, trigger }: { prompt: string; trigger: ReactNode }) {
  async function copyThenOpen(app: AiApp) {
    // The tab opens first, while the click still counts, then the prompt is copied.
    window.open(app.open, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(`Prompt copied. Paste it into ${app.name}.`);
    } catch {
      toast.error("Copy the prompt by hand: the browser did not allow it.");
    }
  }

  return (
    <OpenIn query={prompt}>
      <OpenInTrigger>{trigger}</OpenInTrigger>
      <OpenInContent align="end" className="max-h-96 w-64 overflow-y-auto">
        <OpenInLabel>Opens with the prompt</OpenInLabel>
        {AI_APPS.filter((app) => app.withPrompt).map((app) => (
          <OpenInItem key={app.id} asChild>
            <a
              className={`flex items-center gap-2 ${ICON}`}
              href={app.withPrompt!(prompt)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">{app.logo}</span>
              <span className="flex-1">{app.name}</span>
            </a>
          </OpenInItem>
        ))}
        <OpenInSeparator />
        <OpenInLabel>Copies the prompt, then opens</OpenInLabel>
        {AI_APPS.filter((app) => app.open).map((app) => (
          <OpenInItem
            key={app.id}
            className={`flex items-center gap-2 ${ICON}`}
            onSelect={() => void copyThenOpen(app)}
          >
            <span aria-hidden="true">{app.logo}</span>
            <span className="flex-1">{app.name}</span>
          </OpenInItem>
        ))}
      </OpenInContent>
    </OpenIn>
  );
}
