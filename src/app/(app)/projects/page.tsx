import type { Metadata } from "next";

import { ProjectsView } from "@/components/projects/projects-view";

export const metadata: Metadata = { title: "Projects" };
export const instant = false;

export default function Page() {
  return <ProjectsView />;
}
