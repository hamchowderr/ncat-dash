import { allSteps, getStep } from "@takewon/step-catalog";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { StepForm } from "@/components/steps/step-form";
import { CATEGORY_LABELS, stepHref, stepIdOfPage } from "@/lib/catalog";

export const instant = false;

// The catalog is fixed at build time, so every step page is known ahead of time.
export function generateStaticParams() {
  return allSteps.map((step) => ({ stepId: stepHref(step.id).slice("/steps/".length) }));
}

export async function generateMetadata(props: PageProps<"/steps/[stepId]">): Promise<Metadata> {
  const { stepId } = await props.params;
  return { title: getStep(stepIdOfPage(stepId) ?? stepId)?.title ?? "Step" };
}

export default async function StepPage(props: PageProps<"/steps/[stepId]">) {
  const { stepId: name } = await props.params;
  const step = getStep(stepIdOfPage(name) ?? name);
  if (!step) notFound();
  // An old address, such as the one named after the tool underneath, moves to the plain one.
  if (stepHref(step.id) !== `/steps/${name}`) permanentRedirect(stepHref(step.id));

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/steps" className="hover:underline">
            Steps
          </Link>{" "}
          / {CATEGORY_LABELS[step.category]}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{step.title}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{step.description}</p>
      </div>
      <StepForm stepId={step.id} />
    </>
  );
}
