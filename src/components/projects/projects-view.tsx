"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";

import { Filled, StatusIcon, STATUSES } from "./slot-status";

type Listed = NonNullable<ReturnType<typeof useQuery<typeof api.projects.list>>>[number];

const changed = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Cover({ url }: { url: string | null }) {
  return (
    <span className="bg-muted flex aspect-video h-14 shrink-0 items-center justify-center overflow-hidden rounded-lg">
      {url && (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

/** A project as one row, like a Linear project list: name, client, how far, when changed. */
function ProjectRow({ project }: { project: Listed }) {
  const busy = STATUSES.filter(({ status }) => project.counts[status] > 0);
  return (
    <li>
      <Link
        href={`/projects/${project._id}`}
        transitionTypes={["nav-forward"]}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl bg-surface p-3 outline-none transition-colors focus-visible:ring-3 sm:flex-row sm:items-center"
      >
        <Cover url={project.cover} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-medium">{project.name}</span>
          <span className="text-muted-foreground truncate text-sm">
            {project.package}
            {project.client && ` · ${project.client.name}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs lg:w-72">
          {busy.map(({ status, label }) => (
            <span key={status} className="flex items-center gap-1" title={label}>
              <StatusIcon status={status} className="size-3.5" />
              <span className="tabular-nums">{project.counts[status]}</span>
              <span className="sr-only">{label}</span>
            </span>
          ))}
        </span>
        <span className="shrink-0 lg:w-36">
          <Filled filled={project.filled} total={project.total} />
        </span>
        <span className="text-muted-foreground hidden w-28 shrink-0 text-xs xl:block">
          {changed.format(project.updatedAt)}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground hidden size-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:block"
        />
      </Link>
    </li>
  );
}

/** The team's projects, or one client's when `clientId` is given. */
export function ProjectsList({ clientId }: { clientId?: Id<"clients"> }) {
  const team = useActiveTeam();
  const projects = useQuery(api.projects.list, {
    organizationId: team.id,
    ...(clientId ? { clientId } : {}),
  });
  if (projects === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }
  if (projects.length === 0 && clientId) {
    return (
      <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
        No projects for this client yet.
      </p>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6">
        <p className="text-muted-foreground max-w-prose text-sm">
          No projects yet. A project lays out everything one job delivers, such as an episode, its
          thumbnail and its shorts, so you can see what is done and what is missing.
        </p>
        <Button asChild size="sm">
          <Link href="/projects/new">
            <Plus />
            New project
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <ul className="reveal flex flex-col gap-2">
      {projects.map((project) => (
        <ProjectRow key={project._id} project={project} />
      ))}
    </ul>
  );
}

export function ProjectsView() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Everything one job delivers, slot by slot, from first cut to published.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/projects/new">
            <Plus />
            New project
          </Link>
        </Button>
      </div>
      <ProjectsList />
    </>
  );
}
