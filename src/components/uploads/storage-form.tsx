"use client";

import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";

/** Asks for an S3-compatible bucket, tests it, and saves it only when the test passes. */
export function StorageForm({
  organizationId,
  onSaved,
}: {
  organizationId: string;
  onSaved?: () => void;
}) {
  const connect = useAction(api.storage.connect);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => String(form.get(name) ?? "");
    setFailure(null);
    setPending(true);
    try {
      const result = await connect({
        organizationId,
        endpoint: read("endpoint"),
        region: read("region"),
        bucket: read("bucket"),
        accessKeyId: read("accessKeyId"),
        secretAccessKey: read("secretAccessKey"),
        ...(read("publicUrl").trim() ? { publicUrl: read("publicUrl") } : {}),
      });
      if (result.ok) {
        toast.success("Your storage is connected.");
        onSaved?.();
      } else setFailure(result.detail);
    } catch (caught) {
      setFailure(errorMessage(caught, "The test could not run. Try again in a moment."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="endpoint">Storage address</FieldLabel>
          <Input
            id="endpoint"
            name="endpoint"
            type="url"
            placeholder="https://<account>.r2.cloudflarestorage.com"
            autoComplete="off"
            required
          />
          <FieldDescription>
            The S3 endpoint of your Cloudflare R2, AWS S3, DigitalOcean Spaces or MinIO.
          </FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="bucket">Bucket</FieldLabel>
            <Input id="bucket" name="bucket" autoComplete="off" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="region">Region</FieldLabel>
            <Input id="region" name="region" placeholder="auto" autoComplete="off" />
            <FieldDescription>Leave empty for R2.</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="accessKeyId">Access key ID</FieldLabel>
          <Input id="accessKeyId" name="accessKeyId" autoComplete="off" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="secretAccessKey">Secret access key</FieldLabel>
          <Input
            id="secretAccessKey"
            name="secretAccessKey"
            type="password"
            autoComplete="off"
            required
          />
          <FieldDescription>Stored encrypted and never shown again.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="publicUrl">Public address (optional)</FieldLabel>
          <Input
            id="publicUrl"
            name="publicUrl"
            type="url"
            placeholder="https://files.example.com"
            autoComplete="off"
          />
          <FieldDescription>
            Only if your toolkit hands out file links under its own address (its S3_PUBLIC_URL
            setting). With it here, those links keep working when you rename or move a file.
          </FieldDescription>
        </Field>

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>Your storage did not pass the test</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Testing the connection" : "Test and connect"}
          </Button>
          <FieldDescription>
            Your bucket also needs a CORS rule that allows PUT from this site&apos;s address, so the
            browser can send files straight to it.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
