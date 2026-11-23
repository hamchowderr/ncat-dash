"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Plug, SquareTerminal } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { ChatGptLogo, ClaudeLogo, CursorLogo, N8nLogo } from "@/components/mcp-client-logos";
import { SettingsSection } from "./settings-shell";

/** Where apps reach the dashboard's MCP server. */
export function mcpUrl(): string {
  return `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? ""}/mcp`;
}

/** The name apps list the server under. */
const SERVER_NAME = "content-automations";

function day(at: number) {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copy it by hand: the browser did not allow it.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Line({ text, label, block }: { text: string; label: string; block?: boolean }) {
  return (
    <div className="bg-muted/60 flex items-start gap-2 rounded-lg py-1.5 pr-1.5 pl-3">
      {block ? (
        <pre className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs leading-5">
          {text}
        </pre>
      ) : (
        <code className="min-w-0 flex-1 truncate py-1 font-mono text-xs leading-5" title={text}>
          {text}
        </code>
      )}
      <CopyButton text={text} label={label} />
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="flex flex-col gap-4 text-sm [counter-reset:step] [&>li]:[counter-increment:step]">
      {children}
    </ol>
  );
}

function Step({ children }: { children: ReactNode }) {
  return (
    <li className="before:bg-muted before:text-muted-foreground relative flex flex-col gap-2 pl-8 before:absolute before:top-0 before:left-0 before:flex before:size-5 before:items-center before:justify-center before:rounded-full before:text-[11px] before:font-medium before:content-[counter(step)]">
      {children}
    </li>
  );
}

const Menu = ({ children }: { children: ReactNode }) => (
  <span className="text-foreground font-medium">{children}</span>
);

/** Makes a key for an app that cannot sign in, and shows it once. */
function KeyMaker({ forApp, canEdit, url }: { forApp?: string; canEdit: boolean; url: string }) {
  const team = useActiveTeam();
  const create = useMutation(api.mcpKeys.create);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <p className="text-muted-foreground">Ask a team owner or admin to make the key.</p>;
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = (forApp ?? name).trim();
    setBusy(true);
    try {
      const { key } = await create({ organizationId: team.id, name: label });
      setMade({ name: label, key });
      setName("");
    } catch (caught) {
      toast.error(errorMessage(caught, "The key could not be made. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex gap-2">
        {!forApp && (
          <Input
            aria-label="Which app the key is for"
            placeholder="Which app it is for"
            className="max-w-60"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          className="self-center"
          disabled={busy || (!forApp && !name.trim())}
        >
          {busy ? "Making" : forApp ? `Make a key for ${forApp}` : "Make a key"}
        </Button>
      </form>
      {made && (
        <div role="status" className="flex flex-col gap-2 rounded-lg bg-emerald-50 p-3">
          <p className="font-medium">Copy the key for {made.name} now. It is not shown again.</p>
          <Line text={made.key} label="Copy the new key" />
          <p className="text-muted-foreground">
            The app sends it with each request to {url} as{" "}
            <code className="font-mono text-xs">Authorization: Bearer</code> and the key.
          </p>
        </div>
      )}
    </div>
  );
}

type Platform = {
  id: string;
  name: string;
  logo: ReactNode;
  steps: (url: string, canEdit: boolean) => ReactNode;
};

const PLATFORMS: Platform[] = [
  {
    id: "claude",
    name: "Claude",
    logo: <ClaudeLogo className="size-4" />,
    steps: (url) => (
      <Steps>
        <Step>
          <p>
            In Claude on the web or the desktop app, open <Menu>Settings</Menu>, then{" "}
            <Menu>Connectors</Menu>, and choose <Menu>Add custom connector</Menu>.
          </p>
        </Step>
        <Step>
          <p>Name it and paste the server address:</p>
          <Line text={url} label="Copy the server address for Claude" />
        </Step>
        <Step>
          <p>
            Choose <Menu>Connect</Menu>. Claude opens a page here to sign in and pick the team.
          </p>
        </Step>
      </Steps>
    ),
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    logo: <ChatGptLogo className="size-4" />,
    steps: (url) => (
      <Steps>
        <Step>
          <p>
            In ChatGPT, open <Menu>Settings</Menu>, then <Menu>Apps & Connectors</Menu>, then{" "}
            <Menu>Advanced settings</Menu>, and switch on <Menu>Developer mode</Menu>. It needs a
            paid plan.
          </p>
        </Step>
        <Step>
          <p>
            Choose <Menu>Create</Menu>, name it, paste the server address and pick{" "}
            <Menu>OAuth</Menu>:
          </p>
          <Line text={url} label="Copy the server address for ChatGPT" />
        </Step>
        <Step>
          <p>ChatGPT opens a page here to sign in and pick the team. Turn it on in a chat.</p>
        </Step>
      </Steps>
    ),
  },
  {
    id: "cursor",
    name: "Cursor",
    logo: <CursorLogo className="size-4" />,
    steps: (url) => (
      <Steps>
        <Step>
          <p>
            Open <Menu>Cursor Settings</Menu>, then <Menu>Tools & MCP</Menu>, and choose{" "}
            <Menu>New MCP server</Menu>.
          </p>
        </Step>
        <Step>
          <p>Add it to mcp.json:</p>
          <Line
            block
            text={JSON.stringify({ mcpServers: { [SERVER_NAME]: { url } } }, null, 2)}
            label="Copy the Cursor settings"
          />
        </Step>
        <Step>
          <p>
            Choose <Menu>Connect</Menu> next to it. Cursor opens a page here to sign in and pick the
            team.
          </p>
        </Step>
      </Steps>
    ),
  },
  {
    id: "claude-code",
    name: "Claude Code",
    logo: <SquareTerminal className="size-4 text-[#D97757]" aria-hidden />,
    steps: (url) => (
      <Steps>
        <Step>
          <p>Run:</p>
          <Line
            text={`claude mcp add --transport http ${SERVER_NAME} ${url}`}
            label="Copy the Claude Code command"
          />
        </Step>
        <Step>
          <p>
            Run <code className="font-mono text-xs">/mcp</code> in Claude Code and pick it. It opens
            a page here to sign in and pick the team.
          </p>
        </Step>
      </Steps>
    ),
  },
  {
    id: "n8n",
    name: "n8n",
    logo: <N8nLogo className="size-4" />,
    steps: (url, canEdit) => (
      <Steps>
        <Step>
          <p>n8n connects with a key instead of signing in. Make one:</p>
          <KeyMaker forApp="n8n" canEdit={canEdit} url={url} />
        </Step>
        <Step>
          <p>
            In an <Menu>AI Agent</Menu> node, add the <Menu>MCP Client Tool</Menu>. Set{" "}
            <Menu>Endpoint</Menu> to the server address, <Menu>Server Transport</Menu> to{" "}
            <Menu>HTTP Streamable</Menu> and <Menu>Authentication</Menu> to <Menu>Bearer Auth</Menu>{" "}
            with the key.
          </p>
          <Line text={url} label="Copy the server address for n8n" />
        </Step>
      </Steps>
    ),
  },
  {
    id: "other",
    name: "Other apps",
    logo: <Plug className="text-muted-foreground size-4" aria-hidden />,
    steps: (url, canEdit) => (
      <Steps>
        <Step>
          <p>
            Most apps that support MCP connect the same way: add the server address as a remote
            (HTTP) MCP server, and the app opens a page here to sign in and pick the team.
          </p>
          <Line text={url} label="Copy the server address" />
        </Step>
        <Step>
          <p>If an app cannot sign in, give it a key instead:</p>
          <KeyMaker canEdit={canEdit} url={url} />
        </Step>
      </Steps>
    ),
  },
];

/**
 * The dashboard's MCP server: the address, how to add it in each app, and what is
 * connected. Laid out like Linear's MCP page: pick your app, follow its steps.
 */
export function McpSettings() {
  const team = useActiveTeam();
  const keys = useQuery(api.mcpKeys.list, { organizationId: team.id });
  const [platform, setPlatform] = useState(PLATFORMS[0].id);

  if (keys === undefined) return <Skeleton className="h-60 rounded-lg" />;
  const url = mcpUrl();
  const chosen = PLATFORMS.find((each) => each.id === platform) ?? PLATFORMS[0];

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Connect an app"
        description="Through MCP, an AI app can see your automations, uploads and runs, build and publish automations, switch them on, start runs and approve them. It signs in as you, on the team you pick, and can do what you can."
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Server address</span>
            <Line text={url} label="Copy the MCP server address" />
          </div>
          <div className="flex flex-col gap-5">
            <div role="tablist" aria-label="Apps" className="flex flex-wrap gap-1">
              {PLATFORMS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  role="tab"
                  aria-selected={each.id === chosen.id}
                  onClick={() => setPlatform(each.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    each.id === chosen.id
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span aria-hidden className="flex">
                    {each.logo}
                  </span>
                  {each.name}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-label={chosen.name}>
              {chosen.steps(url, keys.canEdit)}
            </div>
          </div>
        </div>
      </SettingsSection>

      <Connected keys={keys} />
    </div>
  );
}

type Keys = NonNullable<ReturnType<typeof useQuery<typeof api.mcpKeys.list>>>;

/**
 * Apps signed in to this team, and the keys made for apps that cannot sign in. Everyone
 * sees their own sign-ins; owners and admins see everyone's, and the keys.
 */
function Connected({ keys }: { keys: Keys }) {
  const team = useActiveTeam();
  const connections = useQuery(api.oauth.connections, { organizationId: team.id });
  const disconnect = useMutation(api.oauth.disconnect);
  const remove = useMutation(api.mcpKeys.remove);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, run: () => Promise<unknown>, done: string, failed: string) {
    setBusy(id);
    try {
      await run();
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, failed));
    } finally {
      setBusy(null);
    }
  }

  const rows = [
    ...(connections ?? []).map((each) => ({
      id: each.grantId as string,
      name: each.clientName,
      detail: `${each.mine ? "you" : each.person} · since ${day(each.createdAt)} · ${
        each.lastUsedAt ? `last used ${day(each.lastUsedAt)}` : "not used yet"
      }`,
      action: "Disconnect",
      run: () =>
        act(
          each.grantId,
          () => disconnect({ organizationId: team.id, grantId: each.grantId }),
          `${each.clientName} disconnected. It has to sign in again to come back.`,
          "It could not be disconnected. Try again.",
        ),
    })),
    ...keys.keys.map((key) => ({
      id: key.keyId as string,
      name: key.name,
      detail: `key ending in ${key.hint} · made ${day(key.createdAt)} · ${
        key.lastUsedAt ? `last used ${day(key.lastUsedAt)}` : "never used"
      }`,
      action: keys.canEdit ? "Remove" : null,
      run: () =>
        act(
          key.keyId,
          () => remove({ organizationId: team.id, keyId: key.keyId as Id<"mcpKeys"> }),
          `${key.name}'s key removed. Anything using it is turned away from now on.`,
          "The key could not be removed. Try again.",
        ),
    })),
  ];

  return (
    <SettingsSection
      title="Connected"
      description="Apps signed in to this team, and keys made for apps that cannot sign in. Removing one turns it away straight away."
    >
      {connections === undefined ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing is connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Connected apps">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground"> · {row.detail}</span>
              </span>
              {row.action && (
                <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={row.run}>
                  {row.action}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
