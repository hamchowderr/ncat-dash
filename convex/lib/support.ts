import { SupportTickets } from "convex-support-tickets";

import { components } from "../_generated/api";

/** Customers' help requests, kept by the convex-support-tickets component (support.ts). */
export const support = new SupportTickets(components.supportTickets);
