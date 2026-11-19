import type { Tour } from "@/components/ui/tour";

/**
 * The steps of a tour that point at nothing on the page now. The first card of a page tour
 * is a welcome in the middle of the screen, and optional steps are left out when their
 * target is missing, so neither counts.
 */
export function missingTourTargets(tour: Tour, { includeOptional = false } = {}) {
  return tour.steps
    .filter((step, index) => !(index === 0 && step.nextLabel === "Show me"))
    .filter((step) => includeOptional || !step.optional)
    .map((step) => step.id)
    .filter((id) => document.querySelector(`[data-tour-step-id~='${id}']`) === null);
}
