import { MOTTO, PRODUCT_NAME } from "@takewon/automation-core";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Every signed-out screen: the product's mark at the top, the form in the middle of a quiet
 * page, the motto at the foot. Modelled on Linear's sign-in: no frame around the form.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh w-full flex-col">
      <header className="px-6 py-5 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
          aria-label={`${PRODUCT_NAME} home`}
        >
          <ProductMark />
          {PRODUCT_NAME}
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16 sm:items-center sm:pt-0">
        <div className="flex w-full max-w-sm flex-col items-center">{children}</div>
      </main>
      <footer className="text-muted-foreground px-6 pb-6 text-center text-xs">{MOTTO}</footer>
    </div>
  );
}

/** The play-button mark the desktop app and the website use. */
function ProductMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-6" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#5b3df5" />
      <path d="M26 19.5v25L45 32z" fill="#fff" />
    </svg>
  );
}
