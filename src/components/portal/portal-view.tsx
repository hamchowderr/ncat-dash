"use client";

import { api } from "@convex/_generated/api";
import type { DeliverableStatus } from "@convex/lib/packages";
import { readUploadRef } from "@ncat-dash/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { SlotFile } from "@/components/projects/slot-panel";
import { KindIcon } from "@/components/projects/slot-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";

type Agency = { name: string; logo: string | null; color: string | null };

/** Black or white, whichever reads better on the brand colour. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const light = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return light > 0.4 ? "#000000" : "#ffffff";
}

/** The agency's colour as CSS variables, so its buttons and marks wear it. */
function brandStyle(color: string | null): CSSProperties | undefined {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return undefined;
  return { "--brand": color, "--brand-ink": inkOn(color) } as CSSProperties;
}

/**
 * Where the agency's logo shows from: its address, or for an uploaded logo a link the
 * portal's secret opens, since nobody here is signed in. Null until there is one.
 */
function useLogoLink(token: string, logo: string | null): string | null {
  const logoLink = useAction(api.portal.logoLink);
  const uploaded = readUploadRef(logo ?? undefined) !== null;
  const [link, setLink] = useState<{ for: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!uploaded || !logo) return;
    let live = true;
    logoLink({ token })
      .then((url) => live && setLink({ for: logo, url }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token, logo, uploaded, logoLink]);
  if (uploaded) return link?.for === logo ? link.url : null;
  return logo && /^https?:\/\/\S+$/.test(logo) ? logo : null;
}

function AgencyMark({ token, agency }: { token: string; agency: Agency }) {
  const link = useLogoLink(token, agency.logo);
  if (link) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={link} alt={agency.name} className="h-9 max-w-40 object-contain" />;
  }
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg bg-[var(--brand,var(--primary))] text-sm font-semibold text-[var(--brand-ink,var(--primary-foreground))]"
      >
        {agency.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="font-semibold">{agency.name}</span>
    </span>
  );
}

/** The portal's frame: the agency's mark on top, in its colour, around one page. */
function Frame({
  token,
  agency,
  children,
}: {
  token: string;
  agency: Agency;
  children: ReactNode;
}) {
  return (
    <div style={brandStyle(agency.color)} className="flex min-h-svh flex-col">
      <div aria-hidden="true" className="h-1 bg-[var(--brand,var(--primary))]" />
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-5 sm:px-6">
        <AgencyMark token={token} agency={agency} />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}

function Closed() {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-lg font-semibold">This link no longer works</h1>
      <p className="text-muted-foreground text-sm">Ask the team that sent it for a new one.</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-16 sm:px-6">
      <Skeleton className="h-8 w-56 rounded-lg" />
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
    </div>
  );
}

function count(amount: number, one: string, many: string) {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** The front page of a client's portal: their projects, newest first. */
export function PortalView({ token }: { token: string }) {
  const view = useQuery(api.portal.view, { token });
  if (view === undefined) return <Loading />;
  if (view === null) return <Closed />;
  return (
    <Frame token={token} agency={view.agency}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projects for {view.client.name}</h1>
        <p className="text-muted-foreground text-sm">
          From {view.agency.name}. Open a project to see each piece and review what is ready.
        </p>
      </div>
      {view.projects.length === 0 ? (
        <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
          Nothing here yet. Projects show up as soon as the team starts one for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.projects.map((project) => (
            <li key={project._id}>
              <Link
                href={`/portal/${token}/${project._id}`}
                className="group hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-4 rounded-xl bg-surface p-3 outline-none transition-colors focus-visible:ring-3"
              >
                <span className="bg-muted flex aspect-video h-14 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {project.cover && (
                    <video
                      src={`${project.cover}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="size-full object-cover"
                    />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {project.package} · {count(project.approved, "piece", "pieces")} approved of{" "}
                    {project.total}
                  </span>
                </span>
                {project.ready > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--brand,var(--primary))] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-ink,var(--primary-foreground))]">
                    {project.ready} ready for you
                  </span>
                )}
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

const CLIENT_WORDS: Record<DeliverableStatus, string> = {
  todo: "Not started",
  in_progress: "In the works",
  review: "Ready for you",
  approved: "Approved",
  published: "Published",
};

/** One project in a client's portal: every piece, and the way into its review room. */
export function PortalProject({ token, projectId }: { token: string; projectId: string }) {
  const router = useRouter();
  const view = useQuery(api.portal.view, { token });
  const project = useQuery(api.portal.project, { token, projectId });
  const openReview = useMutation(api.portal.openReview);
  const [opening, setOpening] = useState(false);
  if (view === undefined || project === undefined) return <Loading />;
  if (view === null) return <Closed />;

  async function onReview() {
    setOpening(true);
    try {
      const shareToken = await openReview({ token, projectId });
      router.push(
        `/share/${shareToken}?back=${encodeURIComponent(`/portal/${token}/${projectId}`)}`,
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "The review could not be opened. Try again."));
      setOpening(false);
    }
  }

  return (
    <Frame token={token} agency={view.agency}>
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/portal/${token}`}>
            <ArrowLeft />
            All projects
          </Link>
        </Button>
      </div>
      {project === null ? (
        <p className="text-muted-foreground text-sm">This project is not shared here.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <p className="text-muted-foreground text-sm">{project.package}</p>
            </div>
            {project.hasReview && (
              <Button
                disabled={opening}
                onClick={() => void onReview()}
                className="bg-[var(--brand,var(--primary))] text-[var(--brand-ink,var(--primary-foreground))] hover:bg-[var(--brand,var(--primary))]/90"
              >
                <MessagesSquare />
                Review and comment
              </Button>
            )}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {project.slots.map((slot) => (
              <li key={slot._id} className="flex flex-col gap-2 rounded-xl bg-surface p-3">
                {slot.url ? (
                  <SlotFile url={slot.url} className="aspect-video w-full" />
                ) : (
                  <span className="bg-muted flex aspect-video w-full items-center justify-center rounded-lg">
                    <KindIcon kind={slot.kind} className="size-5" />
                  </span>
                )}
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{slot.label}</span>
                  <span
                    data-status={slot.status}
                    className={
                      slot.status === "review"
                        ? "shrink-0 font-medium text-[var(--brand,var(--foreground))]"
                        : "text-muted-foreground shrink-0"
                    }
                  >
                    {CLIENT_WORDS[slot.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  );
}
