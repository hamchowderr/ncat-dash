"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { FilesView } from "./files-view";
import { MadeFiles } from "./made-files";

/** The tab that lists what automations and steps made, as named in the address (?tab=made). */
export const MADE_TAB = "made";
const TABS = [
  { id: "all", label: "All Files" },
  { id: MADE_TAB, label: "Recently Made" },
] as const;

/**
 * Every file in one place: the team's storage as folders, and beside it the files that
 * automations and steps made, newest first, by the run that made them.
 */
export function FilesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") === MADE_TAB ? MADE_TAB : "all";

  function choose(next: string) {
    // Switching tabs starts the folders at the top again.
    router.replace(next === MADE_TAB ? `${pathname}?tab=${MADE_TAB}` : pathname, {
      scroll: false,
    });
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-muted-foreground text-sm">
          Everything in your storage, including what your automations make. Rename, move and sort
          files into folders here, and the automations that use them keep working.
        </p>
      </div>
      <Tabs value={tab} onValueChange={choose} className="gap-4 md:gap-6">
        <TabsList variant="line" aria-label="Files" className="-ml-3">
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="focus-visible:text-foreground flex-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none focus-visible:after:opacity-100"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="all" className="flex flex-col gap-4 md:gap-6">
          <FilesView />
        </TabsContent>
        <TabsContent value={MADE_TAB}>
          <MadeFiles />
        </TabsContent>
      </Tabs>
    </>
  );
}
