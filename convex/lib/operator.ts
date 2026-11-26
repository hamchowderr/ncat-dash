import { ConvexError } from "convex/values";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { getCaller, type Caller } from "./caller";

// The operator is whoever runs this copy of Takewon: on takewon.com, Otaku Solutions.
// They get the Admin pages (emails to customers, subscribers, support). Who they are is
// set by whoever deploys: OPERATOR_EMAILS, a comma-separated list of addresses. Only a
// confirmed address counts, so nobody becomes the operator by signing up with that
// address before its owner does.

/** The addresses in OPERATOR_EMAILS, in lower case. */
export function operatorEmails(): string[] {
  return (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether this signed-in person is the operator. */
export function callerIsOperator(caller: Caller | undefined): boolean {
  if (!caller || caller.emailVerified !== true) return false;
  return operatorEmails().includes(String(caller.email).trim().toLowerCase());
}

export async function isOperator(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<boolean> {
  return callerIsOperator(await getCaller(ctx));
}

/** The operator, or a "forbidden" error for anyone else. */
export async function requireOperator(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<Caller> {
  const caller = await getCaller(ctx);
  if (!caller) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
  if (!callerIsOperator(caller)) {
    throw new ConvexError({ code: "forbidden", message: "Only the operator can do this." });
  }
  return caller;
}
