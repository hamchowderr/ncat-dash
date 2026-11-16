import { stepsByCategory } from "@ncat-dash/step-catalog";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/catalog";

export const metadata: Metadata = { title: "Steps" };
export const instant = false;

const OUTPUT_LABELS = { file: "One file", files: "Several files", json: "Data" } as const;

export default function StepsPage() {
  const grouped = stepsByCategory();
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Steps</h1>
        <p className="text-muted-foreground text-sm">
          Everything your toolkit can do. Open a step to try it on a sample file.
        </p>
      </div>
      {CATEGORY_ORDER.filter((category) => grouped[category]?.length).map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{CATEGORY_LABELS[category]}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {grouped[category].map((step) => (
              <li key={step.id}>
                <Link
                  href={`/steps/${step.id}`}
                  className="bg-card hover:bg-accent/50 focus-visible:ring-ring/50 flex h-full flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10 outline-none transition-colors focus-visible:ring-3"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{step.title}</span>
                    <Badge variant="outline">{OUTPUT_LABELS[step.output]}</Badge>
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-sm">
                    {step.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
