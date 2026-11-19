import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { isActionCtx, isMutationCtx } from "@convex-dev/better-auth/utils";
import {
  DEFAULT_APP_NAME,
  invitationEmail,
  passwordResetEmail,
  verificationEmail,
  type Composed,
} from "@ncat-dash/email";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { organization } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

// Better Auth runs inside this Convex deployment, so a self-hosted owner needs no
// outside auth service. The component is installed locally (convex/betterAuth) so the
// organization plugin's tables are part of its schema.
export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
});

/**
 * Hands an email to `email.send`, which sends it through toSend, or drops it when email
 * is not set up. It is scheduled, not awaited, so sign-in never waits on the mail service
 * and answers in the same time whether or not an address has an account.
 */
async function queueEmail(ctx: GenericCtx<DataModel>, to: string, email: Composed) {
  if (!isMutationCtx(ctx) && !isActionCtx(ctx)) return;
  await ctx.scheduler.runAfter(0, internal.email.send, { to, ...email });
}

type Where = { field: string; operator?: string; value: unknown };

const isEquals = (clause: Where) => !clause.operator || clause.operator === "eq";
const isId = (clause: Where) => clause.field === "id" || clause.field === "_id";

/** Whether a row passes the comparisons this file knows how to make itself. */
function passes(row: Record<string, unknown>, clause: Where): boolean {
  const value = row[isId(clause) ? "id" : clause.field];
  const time = (input: unknown) => (input instanceof Date ? input.getTime() : Number(input));
  switch (clause.operator) {
    case "ne":
      return value !== clause.value;
    case "lte":
      return time(value) <= time(clause.value);
    case "lt":
      return time(value) < time(clause.value);
    case "gte":
      return time(value) >= time(clause.value);
    case "gt":
      return time(value) > time(clause.value);
    default:
      return value === clause.value;
  }
}

/**
 * Better Auth uses up a one-time token (a password reset) by deleting the older tokens
 * for the same thing: "same identifier, id is not X, created at or before T". The Convex
 * adapter refuses "is not" on an id, and a date comparison it has no index for, so the
 * request fails and the password is never changed. For that one shape of question the
 * rows are found by their plain matches and the rest is checked here. Remove this when
 * @convex-dev/better-auth handles it itself.
 */
function database(ctx: GenericCtx<DataModel>): ReturnType<typeof authComponent.adapter> {
  const create = authComponent.adapter(ctx);
  type Adapter = ReturnType<typeof create>;
  const patch = (adapter: Adapter): Adapter => ({
    ...adapter,
    deleteMany: async (args) => {
      const where = args.where as Where[];
      const handled = ["ne", "lte", "lt", "gte", "gt"];
      const special = where.some((clause) => isId(clause) && clause.operator === "ne");
      const plain = where.filter(isEquals);
      const rest = where.filter((clause) => !isEquals(clause));
      if (!special || plain.length === 0 || rest.some((c) => !handled.includes(c.operator!))) {
        return adapter.deleteMany(args);
      }
      const rows = await adapter.findMany<Record<string, unknown>>({
        model: args.model,
        where: plain as typeof args.where,
        limit: 200,
      });
      const doomed = rows.filter((row) => rest.every((clause) => passes(row, clause)));
      for (const row of doomed) {
        await adapter.delete({
          model: args.model,
          where: [{ field: "id", value: String(row.id) }],
        });
      }
      return doomed.length;
    },
    // Better Auth does this work inside a transaction, which hands it the adapter again.
    transaction: (run) => adapter.transaction((inner) => run(patch(inner as Adapter))),
  });
  return (options) => patch(create(options));
}

/**
 * The addresses allowed to sign in: the dashboard's own address, plus any in
 * TRUSTED_ORIGINS (comma-separated, `*` allowed), such as a Vercel preview's
 * `https://ncat-dash-preview-*-otaku-solutions.vercel.app`. Without it, sign-in from any
 * other address fails with "Invalid origin".
 */
export function trustedOrigins(env: Record<string, string | undefined> = process.env) {
  const site = (env.SITE_URL ?? "").replace(/\/+$/, "");
  const extra = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set([site, ...extra].filter(Boolean))];
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const branding = { appName: process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_APP_NAME };
  return {
    baseURL: process.env.SITE_URL,
    trustedOrigins: trustedOrigins(),
    database: database(ctx),
    emailAndPassword: {
      enabled: true,
      // Off unless the owner asks for it: with no email set up, nobody could confirm
      // their address and nobody could sign in.
      requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
      sendResetPassword: async ({ user, url }) => {
        await queueEmail(ctx, user.email, passwordResetEmail({ name: user.name, url }, branding));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await queueEmail(ctx, user.email, verificationEmail({ name: user.name, url }, branding));
      },
    },
    plugins: [
      // Teams: organizations, members, invitations and roles (owner, admin, member).
      organization({
        sendInvitationEmail: async (data) => {
          await queueEmail(
            ctx,
            data.email,
            invitationEmail(
              {
                teamName: data.organization.name,
                inviterName: data.inviter.user.name,
                role: data.role,
                url: `${site}/accept-invitation/${data.id}`,
              },
              branding,
            ),
          );
        },
      }),
      // Required for Convex compatibility.
      convex({ authConfig }),
    ],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

/** The signed-in user, or null. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});
