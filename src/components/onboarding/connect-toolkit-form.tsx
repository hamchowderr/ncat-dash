"use client";

import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { CircleCheckIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const failureTitles = {
  invalid_url: "That address does not look right",
  unreachable: "We could not reach your toolkit",
  unauthorized: "Your toolkit did not accept that key",
  not_a_toolkit: "Something answered, but it is not the NCA Toolkit",
  not_fork: "This is the original NCA Toolkit",
  storage: "Your toolkit's storage is not working",
} as const;

const failureHelp = {
  invalid_url: "Enter the full address, starting with https://",
  unreachable: "Check the address, and that the toolkit is running and open to the internet.",
  unauthorized: "Check the key against the API_KEY set on your toolkit.",
  not_a_toolkit: "Check the address points at the toolkit itself, not another app on the server.",
  not_fork: "",
  storage:
    "Your files go to the toolkit's own bucket. Check the S3 settings on your toolkit (S3_ENDPOINT_URL, S3_BUCKET_NAME and both keys), then try again.",
} as const;

export const FORK_REPO = "https://github.com/hamchowderr/no-code-architects-toolkit";

/**
 * How to move from Stephen's original toolkit to the Otaku Solutions version. Its settings
 * carry over, so it is a change of source and a redeploy.
 */
export function SwitchToFork() {
  return (
    <div className="flex flex-col gap-2">
      <p>
        The dashboard works with the Otaku Solutions version of the toolkit, which adds the storage
        the dashboard uses and fixes the original does not have. Your settings stay the same.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Where your toolkit is deployed (Coolify, Docker, Digital Ocean or Google Cloud), change
          its source to{" "}
          <a className="underline" href={FORK_REPO} target="_blank" rel="noreferrer">
            github.com/hamchowderr/no-code-architects-toolkit
          </a>
          , branch main.
        </li>
        <li>Keep API_KEY and every S3_ setting as they are.</li>
        <li>Redeploy, wait until it is running, then connect it here again.</li>
      </ol>
    </div>
  );
}

type Failure = { reason: keyof typeof failureTitles; detail: string };

/**
 * Asks for a toolkit address and API key, tests them and the toolkit's storage, and saves
 * the connection only when both pass. Storage is the toolkit's own bucket, so this is the
 * whole setup.
 */
export function ConnectToolkitForm({
  organizationId,
  onConnected,
}: {
  organizationId: string;
  onConnected?: () => void;
}) {
  const connect = useAction(api.toolkitConnections.connect);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [build, setBuild] = useState<string | null | undefined>(undefined);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFailure(null);
    setPending(true);
    try {
      const result = await connect({
        organizationId,
        baseUrl: String(form.get("baseUrl") ?? ""),
        apiKey: String(form.get("apiKey") ?? ""),
      });
      if (result.ok) {
        setBuild(result.buildNumber);
        onConnected?.();
      } else {
        setFailure(result);
      }
    } catch {
      setFailure({
        reason: "unreachable",
        detail: "The test could not run. Try again in a moment.",
      });
    } finally {
      setPending(false);
    }
  }

  if (build !== undefined) {
    return (
      <Alert>
        <CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" />
        <AlertTitle>Connected</AlertTitle>
        <AlertDescription>
          Your toolkit answered and accepted the key{build ? ` (build ${build})` : ""}. Your files
          go to its own storage, so there is nothing else to connect.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="baseUrl">Toolkit address</Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          inputMode="url"
          placeholder="https://toolkit.example.com"
          autoComplete="off"
          required
          className="mt-1"
        />
        <p className="text-muted-foreground text-sm">
          The address where your NCA Toolkit is running.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="apiKey">API key</Label>
        <Input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          className="mt-1"
        />
        <p className="text-muted-foreground text-sm">
          The API_KEY you set when you installed the toolkit. It is stored encrypted and never shown
          again.
        </p>
      </div>

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>{failureTitles[failure.reason]}</AlertTitle>
          <AlertDescription>
            {failure.reason === "not_fork" ? <SwitchToFork /> : failureHelp[failure.reason]}
            {failure.reason === "storage" && (
              <p className="text-xs" data-testid="storage-detail">
                {failure.detail}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Testing the connection" : "Test and connect"}
      </Button>
    </form>
  );
}
