import { v } from "convex/values";

/** Every guided tour in the app: the dashboard's, and one for each page that has one. */
export const TOUR_IDS = [
  "dashboard",
  "calendar",
  "automation-editor",
  "review-room",
  "project",
  "library",
  "brand",
  "new-automation",
] as const;

export type TourId = (typeof TOUR_IDS)[number];

export const tourIdValidator = v.union(
  v.literal("dashboard"),
  v.literal("calendar"),
  v.literal("automation-editor"),
  v.literal("review-room"),
  v.literal("project"),
  v.literal("library"),
  v.literal("brand"),
  v.literal("new-automation"),
);
