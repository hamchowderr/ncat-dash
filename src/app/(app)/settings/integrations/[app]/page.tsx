import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IntegrationSection } from "@/components/settings/settings-section";
import { INTEGRATIONS, integration } from "@/components/settings/settings-pages";

export const instant = false;

export function generateStaticParams() {
  return INTEGRATIONS.map((app) => ({ app: app.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ app: string }>;
}): Promise<Metadata> {
  const { app } = await params;
  const found = integration(app);
  return { title: found ? `${found.title} · Integrations` : "Integrations" };
}

export default async function Page({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  const found = integration(app);
  if (!found) notFound();
  return <IntegrationSection slug={found.slug} />;
}
