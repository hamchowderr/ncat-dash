"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { ConnectToolkitForm, FORK_REPO } from "@/components/onboarding/connect-toolkit-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { RECOMMENDED_SETUP, TOOLKIT_IMAGE, toolkitAgentPrompt } from "@/lib/toolkit-agent-prompt";

import { OpenInAiApps } from "./ai-apps";
import { SettingRow, SettingsSection } from "./settings-shell";

const COMPOSE_GUIDE = `${FORK_REPO}/blob/main/docker-compose.md`;

type Connection = {
  _id: Id<"toolkitConnections">;
  ours: boolean;
  baseUrl: string;
  apiKeyHint: string;
  status: "ok" | "failing";
  buildNumber: string | null;
  bucket: string | null;
  lastCheckedAt: number;
  lastError: string | null;
};

/**
 * The toolkit doing the team's media work. Ours by default on a copy that lends one, with
 * nothing to set up; any team can point at its own instead (the Otaku Solutions fork, run on
 * its own server or always-on machine), and go back to ours. One toolkit at a time.
 */
export function ToolkitCard() {
  const team = useActiveTeam();
  const connections = useQuery(api.toolkitConnections.list, { organizationId: team.id });
  const offersOurs = useQuery(api.toolkitConnections.offersOurs, { organizationId: team.id });
  const settings = useQuery(api.teamSettings.get, { organizationId: team.id });
  const [opened, setOpened] = useState(false);

  if (connections === undefined || offersOurs === undefined || settings === undefined) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  const connection: Connection | undefined = connections[0];
  const manager = settings.canEdit;
  const ownOpen = opened || (!connection && !offersOurs);

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection title="In Use">
        {connection ? (
          <Current connection={connection} offersOurs={offersOurs} manager={manager} />
        ) : offersOurs ? (
          <UseOurs label="Not connected yet" manager={manager} />
        ) : (
          <SettingRow
            label="No toolkit yet"
            description="Automations start once a toolkit is connected below."
          />
        )}
      </SettingsSection>

      {manager && (
        <SettingsSection
          title={
            connection && !connection.ours ? "Use A Different Toolkit" : "Use Your Own Toolkit"
          }
          description="Run the toolkit yourself, on your own server or an always-on machine, and the media work and your files stay on it."
          data-testid="own-toolkit"
        >
          {ownOpen ? (
            <OwnToolkit
              onDone={() => {
                toast.success("You're on your own toolkit now.");
                setOpened(false);
              }}
              onCancel={connection || offersOurs ? () => setOpened(false) : undefined}
            />
          ) : (
            <div>
              <Button variant="outline" onClick={() => setOpened(true)}>
                Use your own toolkit
              </Button>
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  );
}

/** The toolkit in use: ours, or the team's own with its address, key and last check. */
function Current({
  connection,
  offersOurs,
  manager,
}: {
  connection: Connection;
  offersOurs: boolean;
  manager: boolean;
}) {
  const recheck = useAction(api.toolkitConnections.recheck);
  const [checking, setChecking] = useState(false);
  const ok = connection.status === "ok";

  async function onRecheck() {
    setChecking(true);
    try {
      const result = await recheck({ connectionId: connection._id });
      if (result.ok) toast.success("Your toolkit is working.");
      else toast.error("Your toolkit did not pass the check.");
    } catch (caught) {
      toast.error(errorMessage(caught, "The check could not run. Try again in a moment."));
    } finally {
      setChecking(false);
    }
  }

  const state = (
    <span className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={ok ? "size-2 rounded-full bg-emerald-500" : "bg-destructive size-2 rounded-full"}
      />
      {ok ? "Working" : "Not answering"}
    </span>
  );

  if (connection.ours) {
    return (
      <SettingRow
        label="Ours, run for you"
        description="We run the toolkit, keep it updated and store your files. Nothing to set up."
      >
        {state}
      </SettingRow>
    );
  }
  return (
    <>
      <SettingRow
        label="Your own toolkit"
        description={
          <>
            <span className="font-mono">{connection.baseUrl}</span>, key ending{" "}
            {connection.apiKeyHint}
            {connection.buildNumber ? `, build ${connection.buildNumber}` : ""}
            {connection.bucket ? `. Files go to the ${connection.bucket} bucket.` : "."}
          </>
        }
      >
        <div className="flex items-center gap-3">
          {state}
          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void onRecheck()}>
            {checking ? "Checking" : "Check again"}
          </Button>
        </div>
      </SettingRow>
      {!ok && connection.lastError && (
        <p role="alert" className="text-destructive text-sm">
          {connection.lastError}
        </p>
      )}
      {offersOurs && manager && <UseOurs label="Or go back to ours" manager={manager} />}
    </>
  );
}

/** Puts the team on the toolkit we run, in place of any other. */
function UseOurs({ label, manager }: { label: string; manager: boolean }) {
  const team = useActiveTeam();
  const connectOurs = useAction(api.toolkitConnections.connectOurs);
  const [busy, setBusy] = useState(false);

  async function onUse() {
    setBusy(true);
    try {
      const result = await connectOurs({ organizationId: team.id });
      if (result.ok) toast.success("You're on our toolkit.");
      else if (result.reason === "busy") toast.error(result.detail);
      else toast.error("Our toolkit did not answer just now. Try again in a minute.");
    } catch (caught) {
      toast.error(errorMessage(caught, "Our toolkit did not answer just now."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow
      label={label}
      description="We run the toolkit, keep it updated and store your files."
    >
      {manager && (
        <Button size="sm" disabled={busy} onClick={() => void onUse()}>
          {busy ? "Connecting" : "Use ours"}
        </Button>
      )}
    </SettingRow>
  );
}

/**
 * Running your own: a prompt for the team's own AI agent to set it up, the setup we run
 * ours on, the steps by hand, then its address and key, tested before it is saved.
 */
function OwnToolkit({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const team = useActiveTeam();
  return (
    <div className="flex flex-col gap-8">
      <AgentPrompt />
      <RecommendedSetup />
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Or do it yourself</h3>
        <ol className="text-muted-foreground flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            <span className="text-foreground font-medium">Run the toolkit.</span> Use the Otaku
            Solutions version of the NCA Toolkit, free and open source:{" "}
            <a
              className="text-foreground inline-flex items-center gap-0.5 underline underline-offset-4"
              href={FORK_REPO}
              target="_blank"
              rel="noreferrer"
            >
              github.com/hamchowderr/no-code-architects-toolkit
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            . Its ready-built image is{" "}
            <span className="text-foreground font-mono">{TOOLKIT_IMAGE}</span>. Run it with Docker
            or Coolify on a server, or on a computer that stays on, following{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href={COMPOSE_GUIDE}
              target="_blank"
              rel="noreferrer"
            >
              the Docker guide
            </a>
            .
          </li>
          <li>
            <span className="text-foreground font-medium">Give it storage.</span> Uploads and
            finished files go to the toolkit&apos;s own bucket. Any S3-style storage works, such as
            Cloudflare R2, Backblaze B2, DigitalOcean Spaces or Amazon S3: set S3_ENDPOINT_URL,
            S3_BUCKET_NAME, S3_ACCESS_KEY, S3_SECRET_KEY and S3_REGION on the toolkit, and let the
            bucket take uploads from this dashboard (CORS for PUT, GET and HEAD with the
            Content-Type header, exposing ETag).
          </li>
          <li>
            <span className="text-foreground font-medium">Pick a key.</span> Set API_KEY on the
            toolkit to a long random value, then put its address and that key below. We test both,
            and its storage, before switching you over.
          </li>
        </ol>
      </div>
      <ConnectToolkitForm organizationId={team.id} onConnected={onDone} />
      {onCancel && (
        <div>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

const noChange = () => () => {};

/** This dashboard's address, which the bucket must accept uploads from. */
function useDashboardAddress(): string {
  return useSyncExternalStore(
    noChange,
    () => window.location.origin,
    () => "",
  );
}

/** One prompt for any AI agent: installs, updates or replaces the team's toolkit. */
function AgentPrompt() {
  const prompt = toolkitAgentPrompt(useDashboardAddress());
  return (
    <div className="flex flex-col gap-3" data-testid="agent-prompt">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Have your AI agent do it</h3>
        <p className="text-muted-foreground text-sm">
          Copy it into Claude Code, Codex or any agent that can reach your server or computer, or
          open it in any AI app. It installs the toolkit, updates the one you run, or replaces one
          that is not ours, then gives you the address and key to put below.
        </p>
      </div>
      <CodeBlock
        code={prompt}
        language="markdown"
        className="[&_pre]:max-h-72 [&_pre]:overflow-auto [&_pre]:text-xs [&_pre]:leading-relaxed [&_pre]:whitespace-pre-wrap"
      >
        <CodeBlockHeader>
          <CodeBlockTitle>Prompt for your AI agent</CodeBlockTitle>
          <CodeBlockActions>
            <OpenInAiApps
              prompt={prompt}
              trigger={
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
                  Open in
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <CodeBlockCopyButton
              aria-label="Copy prompt"
              onError={() => toast.error("Copy the prompt by hand: the browser did not allow it.")}
            />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    </div>
  );
}

/** What our own toolkit runs on, the setup we recommend. */
function RecommendedSetup() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Recommended setup</h3>
        <p className="text-muted-foreground text-sm">
          The same setup our own toolkit runs on. The prompt above uses it.
        </p>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        {RECOMMENDED_SETUP.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <dt className="font-medium">{item.label}</dt>
            <dd className="text-muted-foreground break-words">{item.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
