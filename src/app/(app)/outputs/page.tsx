import { redirect } from "next/navigation";

// Outputs is now the Recently Made tab of Files; old links and bookmarks land there.
export default function Page() {
  redirect("/files?tab=made");
}
