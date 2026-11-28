import { FlaskConical, History, LifeBuoy, Send, Users, type LucideIcon } from "lucide-react";

/**
 * The Platform Admin pages in the side menu. Only the operator (whoever runs this copy, see
 * convex/lib/operator.ts) sees them. Add a page by adding an entry here.
 */
export type AdminRoute = { title: string; url: string; icon: LucideIcon };

export const adminRoutes: AdminRoute[] = [
  { title: "Send An Email", url: "/admin/emails/new", icon: Send },
  { title: "Sent Emails", url: "/admin/emails", icon: History },
  { title: "Subscribers", url: "/admin/subscribers", icon: Users },
  { title: "Beta Testers", url: "/admin/beta", icon: FlaskConical },
  { title: "Support", url: "/admin/support", icon: LifeBuoy },
];

/** The Admin entry a path belongs to; the longest match wins, so a new email is not "Sent". */
export function adminRouteFor(pathname: string): AdminRoute | undefined {
  return [...adminRoutes]
    .sort((a, b) => b.url.length - a.url.length)
    .find((route) => pathname === route.url || pathname.startsWith(`${route.url}/`));
}
