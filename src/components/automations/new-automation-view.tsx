"use client";

import { api } from "@convex/_generated/api";
import type { Starter } from "@takewon/automation-core";
import { useMutation } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageTourButton, StartPageTour } from "@/components/tours/page-tour";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { TemplateGallery } from "./template-gallery";

/**
 * Starting an automation: every template on a page of its own, rather than squeezed into a
 * window over the list. Picking one makes the automation and opens it on the canvas.
 */
export function NewAutomationView() {
  const team = useActiveTeam();
  const router = useRouter();
  const create = useMutation(api.automations.create);
  const [pending, setPending] = useState(false);

  async function onPick(starter: Starter | null) {
    setPending(true);
    try {
      const id = await create({
        organizationId: team.id,
        name: starter?.name ?? "New automation",
        starterId: starter?.id,
      });
      router.replace(`/automations/${id}`, { transitionTypes: ["nav-forward"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The automation could not be created. Try again."));
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2">
          <Link href="/automations" transitionTypes={["nav-back"]}>
            <ArrowLeft />
            <span className="sr-only">Back to automations</span>
          </Link>
        </Button>
        <div className="grid flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">New automation</h1>
          <p className="text-muted-foreground text-sm">
            Pick a template to open it on the canvas. Everything can be changed there.
          </p>
        </div>
        <PageTourButton tourId="new-automation" className="self-start" />
      </div>
      {/* Once a template is picked the page is on its way out: no tour starts over it. */}
      <StartPageTour tourId="new-automation" ready={!pending} />
      <TemplateGallery disabled={pending} onPick={onPick} />
    </>
  );
}
