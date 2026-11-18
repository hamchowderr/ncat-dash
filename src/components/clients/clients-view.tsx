"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { useFileLink } from "@/lib/use-brand-upload";

type Listed = NonNullable<ReturnType<typeof useQuery<typeof api.clients.list>>>[number];

function count(amount: number, one: string, many: string) {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** The client's logo once it has one, else its first letter on its colour. */
export function ClientMark({
  name,
  logo,
  color,
}: {
  name: string;
  logo: string | null;
  color: string | null;
}) {
  const link = useFileLink(logo ?? undefined);
  if (link) {
    return (
      <span className="bg-background flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={link} alt="" className="size-full object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={color ? { backgroundColor: color, color: "white" } : undefined}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ClientRow({ client }: { client: Listed }) {
  return (
    <li>
      <Link
        href={`/clients/${client._id}`}
        transitionTypes={["nav-forward"]}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl bg-surface p-3 outline-none transition-colors focus-visible:ring-3"
      >
        <ClientMark name={client.name} logo={client.logo} color={client.color} />
        <span className="min-w-0 flex-1 truncate text-base font-medium">{client.name}</span>
        <span className="text-muted-foreground hidden w-36 text-sm sm:block">
          {count(client.projects, "project", "projects")}
        </span>
        <span className="text-muted-foreground hidden w-36 text-sm sm:block">
          {count(client.automations, "automation", "automations")}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

function AddClient() {
  const team = useActiveTeam();
  const router = useRouter();
  const create = useMutation(api.clients.create);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const id = await create({ organizationId: team.id, name });
      setName("");
      router.push(`/clients/${id}`, { transitionTypes: ["nav-forward"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The client could not be added. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        aria-label="Client name"
        placeholder="Client name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        className="h-8 w-56"
      />
      <Button type="submit" size="sm" disabled={pending || !name.trim()}>
        <Plus />
        Add client
      </Button>
    </form>
  );
}

/**
 * The agency's clients inside one team. Each has its own brand, music and delivery folder,
 * and the automations and projects done for it.
 */
export function ClientsView() {
  const team = useActiveTeam();
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Who you make content for. Each client has its own brand and delivery folder, used by its
            automations and projects.
          </p>
        </div>
        <AddClient />
      </div>
      {clients === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : clients.length === 0 ? (
        <p className="text-muted-foreground max-w-prose rounded-xl bg-surface px-4 py-3 text-sm">
          No clients yet. Add one when you make content for someone else, so their automations use
          their logo and colours and their files land in their own folder.
        </p>
      ) : (
        <ul className="reveal flex flex-col gap-2">
          {clients.map((client) => (
            <ClientRow key={client._id} client={client} />
          ))}
        </ul>
      )}
    </>
  );
}
