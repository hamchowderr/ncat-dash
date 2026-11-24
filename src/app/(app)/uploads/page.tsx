import { redirect } from "next/navigation";

// Uploading now happens on the Library; old links and bookmarks land there.
export default function Page() {
  redirect("/library");
}
