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
} as const;

const failureHelp = {
  invalid_url: "Enter the full address, starting with https://",
  unreachable: "Check the address, and that the toolkit is running and open to the internet.",
  unauthorized: "Check the key against the API_KEY set on your toolkit.",
  not_a_toolkit: "Check the address points at the toolkit itself, not another app on the server.",
} as const;

type Failure = { reason: keyof typeof failureTitles; detail: string };

/**
 * Asks for a toolkit address and API key, tests them, and saves the connection only
 * when the test passes.
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
          Your toolkit answered and accepted the key{build ? ` (build ${build})` : ""}.
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
          <AlertDescription>{failureHelp[failure.reason]}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Testing the connection" : "Test and connect"}
      </Button>
    </form>
  );
}
