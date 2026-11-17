import type { Metadata } from "next";

import { ReviewsView } from "@/components/review/reviews-view";

export const metadata: Metadata = { title: "Review" };
export const instant = false;

export default function Page() {
  return <ReviewsView />;
}
