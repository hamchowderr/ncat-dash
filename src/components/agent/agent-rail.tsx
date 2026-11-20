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
 * The agent's sidebar folded away: a slim strip down the right edge, the mirror of the
 * menu folded to icons on the left. Its button, or anywhere along it, opens the agent.
 */
export function AgentRail() {
  return (
    <div className="flex h-full w-12 flex-col items-center">
      <div className="flex h-16 shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-tour-step-id="tour-agent"
              aria-label="Open the agent"
              aria-keyshortcuts="Meta+J Control+J"
              onClick={() => showAgent(true)}
            >
              <Bot />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Open the agent <kbd data-slot="kbd">{shortcutLabel()}</kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      {/* The rest of the strip opens it too, like the edge of the menu on the left. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-agent-rail
        onClick={() => showAgent(true)}
        className="w-full flex-1 cursor-pointer"
      />
    </div>
  );
}

/**
 * On a phone there is no room for the strip, so the bar along the top carries the same
 * button, as it carries the menu's on the left.
 */
export function AgentTrigger({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      data-tour-step-id="tour-agent"
      aria-label="Open the agent"
      onClick={() => showAgent(true)}
    >
      <Bot />
    </Button>
  );
}
