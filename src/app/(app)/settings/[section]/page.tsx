import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  SETTINGS_PAGES,
  settingsPage,
  settingsPageFor,
} from "@/components/settings/settings-pages";
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
  const page = settingsPage(section);
  return { title: page ? `${page.title} · Settings` : "Settings" };
}

/** Addresses settings used to have. `/settings/chat` held Slack and Discord together. */
const OLD = new Set(["chat", "members", "jobs", "failures"]);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const page = settingsPage(section);
  if (page) return <SettingsSection slug={page.slug} />;
  if (!OLD.has(section)) notFound();
  const query = await searchParams;
  const kept = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  ).toString();
  const to = section === "chat" && query.discord ? "discord" : settingsPageFor(section);
  redirect(`/settings/${to}${kept ? `?${kept}` : ""}`);
}
