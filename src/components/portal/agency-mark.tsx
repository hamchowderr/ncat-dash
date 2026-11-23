"use client";

import { readUploadRef } from "@takewon/automation-core";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// The agency's look, for pages its clients see without signing in: the portal and the
// review rooms it opens.

export type Agency = { name: string; logo: string | null; color: string | null };

/** Black or white, whichever reads better on the brand colour. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const light = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return light > 0.4 ? "#000000" : "#ffffff";
}

/** The agency's colour as CSS variables, so its buttons and marks wear it. */
export function brandStyle(color: string | null): CSSProperties | undefined {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return undefined;
  return { "--brand": color, "--brand-ink": inkOn(color) } as CSSProperties;
}

/**
 * Where the agency's logo shows from: its address, or for an uploaded logo a link that the
 * page's own secret opens, since nobody here is signed in. Null until there is one.
 */
export function useLogoLink(
  logo: string | null,
  getLink: () => Promise<string | null>,
): string | null {
  const uploaded = readUploadRef(logo ?? undefined) !== null;
  const ask = useRef(getLink);
  useEffect(() => {
    ask.current = getLink;
  });
  const [link, setLink] = useState<{ for: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!uploaded || !logo) return;
    let live = true;
    ask
      .current()
      .then((url) => live && setLink({ for: logo, url }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [logo, uploaded]);
  if (uploaded) return link?.for === logo ? link.url : null;
  return logo && /^https?:\/\/\S+$/.test(logo) ? logo : null;
}

/** The agency's logo, or its first letter in its colour beside its name. */
export function AgencyMark({
  agency,
  getLink,
  small = false,
}: {
  agency: Agency;
  getLink: () => Promise<string | null>;
  small?: boolean;
}) {
  const link = useLogoLink(agency.logo, getLink);
  if (link) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={link}
        alt={agency.name}
        className={cn("object-contain", small ? "h-7 max-w-32" : "h-9 max-w-40")}
      />
    );
  }
  return (
    <span className={cn("flex items-center", small ? "gap-2" : "gap-2.5")}>
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-lg bg-[var(--brand,var(--primary))] font-semibold text-[var(--brand-ink,var(--primary-foreground))]",
          small ? "size-7 text-xs" : "size-9 text-sm",
        )}
      >
        {agency.name.slice(0, 1).toUpperCase()}
      </span>
      <span className={cn("font-semibold", small && "text-sm")}>{agency.name}</span>
    </span>
  );
}
