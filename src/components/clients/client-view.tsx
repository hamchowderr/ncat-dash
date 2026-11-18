"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ProjectsList } from "@/components/projects/projects-view";
import { BrandForm } from "@/components/settings/brand-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";

import { ClientMark } from "./clients-view";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.clients.get>>>;

function Section({
  title,
  line,
  action,
  children,
}: {
  title: string;
  line?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {line && <p className="text-muted-foreground max-w-prose text-sm">{line}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DeliveryFolder({ client }: { client: Loaded }) {
  const setFolder = useMutation(api.clients.setDeliveryFolder);
  const [folder, setFolderText] = useState(client.deliveryFolder);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await setFolder({ clientId: client._id, folder });
      toast.success("Saved");
    } catch (caught) {
      toast.error(errorMessage(caught, "That folder could not be saved."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex max-w-lg gap-2">
        <Input
          aria-label="Folder"
          placeholder={`Clients/${client.name}`}
          value={folder}
          onChange={(event) => setFolderText(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || folder === client.deliveryFolder}
        >
          Save
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Finished files go to{" "}
        <span className="text-foreground font-medium">{client.deliversTo}</span> in your files, in a
        folder for each automation.
      </p>
    </form>
  );
}

function Header({ client }: { client: Loaded }) {
  const router = useRouter();
  const rename = useMutation(api.clients.rename);
  const remove = useMutation(api.clients.remove);
  const [name, setName] = useState(client.name);
  const [confirming, setConfirming] = useState(false);

  async function saveName() {
    const next = name.trim();
    if (!next || next === client.name) return setName(client.name);
    try {
      await rename({ clientId: client._id, name: next });
    } catch (caught) {
      setName(client.name);
      toast.error(errorMessage(caught, "The client could not be renamed."));
    }
  }

  async function onRemove() {
    try {
      await remove({ clientId: client._id });
      router.replace("/clients", { transitionTypes: ["nav-back"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The client could not be deleted."));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild variant="ghost" size="icon" className="-ml-2">
        <Link href="/clients" transitionTypes={["nav-back"]}>
          <ArrowLeft />
          <span className="sr-only">Back to clients</span>
        </Link>
      </Button>
      <ClientMark
        name={client.name}
        logo={client.brand.logo ?? null}
        color={client.brand.color ?? null}
      />
      <Input
        aria-label="Client name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void saveName()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(client.name);
        }}
        className="h-9 max-w-sm flex-1 border-transparent px-1.5 text-xl font-semibold tracking-tight shadow-none md:text-xl hover:border-input"
      />
      {client.canDelete && (
        <div className="ml-auto">
          {confirming ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Delete {client.name}? Its projects and automations stay, for your team.
              <Button size="sm" variant="destructive" onClick={() => void onRemove()}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 />
              Delete client
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Client({ client }: { client: Loaded }) {
  const setBrand = useMutation(api.clients.setBrand);
  const team = client.teamBrand;
  const fallback = [
    team.color && `colour ${team.color}`,
    team.font && `font ${team.font}`,
    team.logo && "logo",
  ].filter(Boolean);

  return (
    <>
      <Header key={client.name} client={client} />

      <div className="flex max-w-4xl flex-col gap-10">
        <Section
          title="Projects"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/projects/new?client=${client._id}`}>
                <Plus />
                New project
              </Link>
            </Button>
          }
        >
          <ProjectsList clientId={client._id} />
        </Section>

        <Section
          title="Automations"
          line="Runs of these use this client's brand and deliver to its folder. Pick the client at the top of an automation."
        >
          {client.automations.length === 0 ? (
            <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
              No automations for this client yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {client.automations.map((automation) => (
                <li key={automation._id}>
                  <Link
                    href={`/automations/${automation._id}`}
                    className="group hover:bg-muted flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate">{automation.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {automation.enabled ? "On" : "Off"}
                    </span>
                    <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Brand"
          line={
            fallback.length > 0
              ? `Anything left empty uses your team's: ${fallback.join(", ")}. Music set here replaces your team's library for this client.`
              : "Anything left empty uses your team's brand. Music set here replaces your team's library for this client."
          }
        >
          <div className="max-w-2xl">
            <BrandForm
              brand={client.brand}
              music={client.music}
              canEdit
              submitLabel="Save client brand"
              save={(typed) => setBrand({ clientId: client._id, ...typed })}
            />
          </div>
        </Section>

        <Section title="Delivery folder" line="Where this client's finished files are kept.">
          <DeliveryFolder client={client} />
        </Section>
      </div>
    </>
  );
}

export function ClientView({ clientId }: { clientId: Id<"clients"> }) {
  const client = useQuery(api.clients.get, { clientId });
  if (client === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (client === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">This client no longer exists.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/clients">Back to clients</Link>
        </Button>
      </div>
    );
  }
  return <Client client={client} />;
}
