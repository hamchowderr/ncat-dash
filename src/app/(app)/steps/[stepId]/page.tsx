import { getStep, steps } from "@ncat-dash/step-catalog";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StepForm } from "@/components/steps/step-form";
import { CATEGORY_LABELS } from "@/lib/catalog";

export const instant = false;

// The catalog is fixed at build time, so every step page is known ahead of time.
export function generateStaticParams() {
  return steps.map((step) => ({ stepId: step.id }));
}

export async function generateMetadata(props: PageProps<"/steps/[stepId]">): Promise<Metadata> {
  const { stepId } = await props.params;
  return { title: getStep(stepId)?.title ?? "Step" };
}

export default async function StepPage(props: PageProps<"/steps/[stepId]">) {
  const { stepId } = await props.params;
  const step = getStep(stepId);
  if (!step) notFound();

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
