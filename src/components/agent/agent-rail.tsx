"use client";

import { Bot } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { showAgent } from "@/lib/agent-open";

/** The key that opens and closes the agent with Cmd (Mac) or Ctrl, as Notion's AI does. */
export const AGENT_SHORTCUT = "j";

/** Cmd+J or Ctrl+J opens the agent, and closes it again. */
export function useAgentShortcut(open: boolean) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== AGENT_SHORTCUT) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      showAgent(!open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

function shortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl J";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘J" : "Ctrl J";
}

/**
 * The agent's button in the bar along the top of the page, on the right: the mirror of
 * the menu's button on the left. It opens the agent's sidebar beside the page.
 */
export function AgentTrigger({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={className}
          data-tour-step-id="tour-agent"
          aria-label="Open the agent"
          aria-keyshortcuts="Meta+J Control+J"
          onClick={() => showAgent(true)}
        >
          <Bot />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Open the agent <kbd data-slot="kbd">{shortcutLabel()}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
