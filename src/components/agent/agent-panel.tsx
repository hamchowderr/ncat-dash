"use client";

import { PanelRightClose } from "lucide-react";
import { useRouter } from "next/navigation";

import { ChatPanel } from "@/components/chat-panel/chat-panel";
import { Button } from "@/components/ui/button";

import { APPROVAL_VIEWS } from "./approval-views";
import { ToolRow } from "./tool-row";
import { errorWords } from "./tool-words";

export function AgentPanel({
  onAutomation,
  onClose,
}: {
  onAutomation: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <ChatPanel
      title="Agent"
      plan={false}
      className="bg-sidebar [--chat-panel-header-height:4rem]"
      greeting={{
        title: "What should run by itself?",
        description:
          "Describe it and the agent builds the automation. It asks before it changes anything.",
      }}
      placeholder="Describe an automation, or a change to this one"
      suggestions={
        onAutomation
          ? [
              {
                label: "Explain this automation",
                prompt: "Explain what this automation does, step by step.",
              },
              {
                label: "Check it for problems",
                prompt: "Check this automation for anything missing or wrong.",
              },
            ]
          : [
              {
                label: "What do I have?",
                prompt: "List my automations and say which are switched on.",
              },
              {
                label: "Clips from each new recording",
                prompt:
                  "Build an automation that makes short clips with captions from each new recording I upload.",
              },
            ]
      }
      approvalViews={APPROVAL_VIEWS}
      renderTool={(call, result) => <ToolRow call={call} result={result} />}
      errorWords={errorWords}
      onNavigate={(href) => router.push(href)}
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-keyshortcuts="Meta+J Control+J"
          onClick={onClose}
        >
          <PanelRightClose />
          <span className="sr-only">Close the agent</span>
        </Button>
      }
    />
  );
}
