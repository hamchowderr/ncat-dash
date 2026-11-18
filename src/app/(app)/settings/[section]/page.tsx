import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SETTINGS_PAGES } from "@/components/settings/settings-pages";
import { SettingsSection } from "@/components/settings/settings-section";

export const instant = false;

export function generateStaticParams() {
  return SETTINGS_PAGES.map((page) => ({ section: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  const page = SETTINGS_PAGES.find((p) => p.slug === section);
  return { title: page ? `${page.title} · Settings` : "Settings" };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const page = SETTINGS_PAGES.find((p) => p.slug === section);
  if (!page) notFound();
  return <SettingsSection slug={page.slug} />;
}
