import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { isActionCtx, isMutationCtx } from "@convex-dev/better-auth/utils";
import {
  DEFAULT_APP_NAME,
  emailChangeEmail,
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
  type Composed,
} from "@takewon/email";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { jwt, organization } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { networkKey } from "./lib/clientIp";
import { getEdition } from "./lib/edition";
import { requireEmailVerification, socialProviders } from "./lib/signInOptions";
import { isThrowawayEmail } from "./lib/emailKey";
import { emailBranding } from "./lib/emailBranding";
import {
  ACCESS_TOKEN_SECONDS,
  AGENT_SCOPES,
  agentIssuer,
  fetchClientMetadata,
  mcpResource,
  REFRESH_TOKEN_SECONDS,
  TEAM_CLAIM,
} from "./lib/agentSignIn";
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
 * `https://takewon-*-otaku-solutions.vercel.app`. Without it, sign-in from any
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

/** Which allowance a Better Auth path takes from, or null for one that isn't limited. */
export function authAttemptKind(path: string | undefined): "signIn" | "email" | null {
  if (path === "/sign-in/email") return "signIn";
  if (
    path === "/request-password-reset" ||
    path === "/forget-password" ||
    path === "/send-verification-email"
  )
    return "email";
  return null;
}

type Runner = Pick<
  Extract<GenericCtx<DataModel>, { runMutation: unknown }>,
  "runMutation" | "runQuery"
>;

/** The Convex functions a sign-in hook can call, or null where it has none (a query). */
function runner(ctx: GenericCtx<DataModel>): Runner | null {
  return isMutationCtx(ctx) || isActionCtx(ctx) ? ctx : null;
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const branding = emailBranding(process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_APP_NAME);
  return {
    baseURL: process.env.SITE_URL,
    trustedOrigins: trustedOrigins(),
    // The jwt plugin is here for agents' access tokens only (mcp() below): its own
    // session-token route is off, so a signed-in person's token can't pass for one.
    disabledPaths: ["/token"],
    database: database(ctx),
    emailAndPassword: {
      enabled: true,
      // Off unless the owner asks for it: with no email set up, nobody could confirm
      // their address and nobody could sign in.
      requireEmailVerification: requireEmailVerification(),
      sendResetPassword: async ({ user, url }) => {
        await queueEmail(ctx, user.email, passwordResetEmail({ name: user.name, url }, branding));
      },
      // A reset signs every device out, in case the old password was known to someone else.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await queueEmail(
          ctx,
          user.email,
          passwordChangedEmail({ name: user.name, url: `${site}/forgot-password` }, branding),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in before confirming sends a fresh link (only asked for when confirming is
      // required), so an old, expired one never leaves someone stuck.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      // A day, not the default hour: people often open these the next morning.
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await queueEmail(ctx, user.email, verificationEmail({ name: user.name, url }, branding));
      },
    },
    // Sign in with Google, offered only once its keys are set (see socialProviders()).
    socialProviders: socialProviders(),
    user: {
      // Deleting your own account (Settings > Account). Better Auth asks for the password,
      // or a recent sign-in for an account without one. Its teams are dealt with first
      // (accountDeletion.ts): one only this person is on goes with it, and the only owner
      // of a team others are on is asked to hand it over or delete it first.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const run = runner(ctx);
          if (!run) return;
          const refused = await run.runMutation(internal.accountDeletion.prepare, {
            userId: user.id,
          });
          if (refused) throw new APIError("BAD_REQUEST", { message: refused });
        },
      },
      // Moving an account to a new address: the old address approves first, then the new
      // one confirms, so a stolen session alone can't take the account away.
      changeEmail: {
        enabled: true,
        // An address nobody has confirmed (a copy that doesn't ask for confirmation) is
        // simply replaced: there is nothing to approve it from, and with no email set up
        // the new one could never be confirmed either.
        updateEmailWithoutVerification: !requireEmailVerification(),
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await queueEmail(
            ctx,
            user.email,
            emailChangeEmail({ name: user.name, newEmail, url }, branding),
          );
        },
      },
    },
    hooks: {
      // Password sign-ins and emails sent on request are limited per network and per
      // account (access.takeAuthAttempt), so passwords can't be guessed quickly and the
      // dashboard can't flood someone's inbox. The network comes from the signed address
      // the dashboard adds (lib/clientIp.ts), which a caller can't make up.
      before: createAuthMiddleware(async (hook) => {
        const kind = authAttemptKind(hook.path);
        const run = runner(ctx);
        if (!kind || !run) return;
        const email = typeof hook.body?.email === "string" ? hook.body.email : undefined;
        const refused = await run.runMutation(internal.access.takeAuthAttempt, {
          kind,
          networkKey: await networkKey(hook.headers ?? hook.request?.headers),
          ...(email ? { email } : {}),
        });
        if (refused) throw new APIError("TOO_MANY_REQUESTS", { message: refused });
      }),
      // A changed password gets the same "was this you?" note a reset does.
      after: createAuthMiddleware(async (hook) => {
        if (hook.path !== "/change-password") return;
        const user = hook.context.session?.user;
        if (!user || hook.context.returned instanceof Error) return;
        await queueEmail(
          ctx,
          user.email,
          passwordChangedEmail({ name: user.name, url: `${site}/forgot-password` }, branding),
        );
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // On the hosted edition, where every new account can start a free trial:
          // throwaway email services are refused, and so is a burst of sign-ups from one
          // network or from everywhere at once.
          before: async (user, endpoint) => {
            const run = runner(ctx);
            if (!run) return;
            // An invite-only copy (SIGN_UPS=invite-only) takes only its owner and the
            // people invited to a team.
            const closed = await run.runQuery(internal.access.signUpRefusal, { email: user.email });
            if (closed) throw new APIError("FORBIDDEN", { message: closed });
            if (getEdition() !== "hosted") return;
            if (isThrowawayEmail(user.email)) {
              throw new APIError("BAD_REQUEST", {
                message: "Use your own email address. Throwaway email services can't be used here.",
              });
            }
            const network = await networkKey(endpoint?.headers ?? endpoint?.request?.headers);
            const refused = await run.runMutation(internal.access.takeSignUp, {
              networkKey: network,
            });
            if (refused) throw new APIError("TOO_MANY_REQUESTS", { message: refused });
          },
          after: async (user, endpoint) => {
            const run = runner(ctx);
            if (!run) return;
            // Someone who asked to join the beta on the website has now joined.
            await run.runMutation(internal.beta.joined, { userId: user.id, email: user.email });
            // The sign-up form's product news box, unticked unless they ticked it.
            const body = (endpoint as { body?: Record<string, unknown> } | null)?.body;
            if (body?.productNews === true) {
              const headers = endpoint?.headers ?? endpoint?.request?.headers;
              await run.runMutation(internal.news.fromSignUp, {
                userId: user.id,
                email: user.email,
                ...(user.name ? { name: user.name } : {}),
                networkKey: await networkKey(headers),
                ...(headers?.get("user-agent") ? { userAgent: headers.get("user-agent")! } : {}),
              });
            }
            if (getEdition() !== "hosted") return;
            await run.runMutation(internal.access.recordSignUp, {
              userId: user.id,
              email: user.email,
              networkKey: await networkKey(endpoint?.headers ?? endpoint?.request?.headers),
            });
          },
        },
      },
      session: {
        create: {
          // Someone the operator blocked can't sign in (blocks.ts).
          before: async (session) => {
            const run = runner(ctx);
            if (!run) return;
            if (await run.runQuery(internal.access.userBlocked, { userId: session.userId })) {
              throw new APIError("FORBIDDEN", {
                message: "This account has been paused. Contact the people who run this dashboard.",
              });
            }
          },
        },
      },
    },
    plugins: [
      // Teams: organizations, members, invitations and roles (owner, admin, member).
      organization({
        organizationHooks: {
          // Each team on the hosted edition gets a free trial, so one person can make only
          // a few teams a day.
          beforeCreateOrganization: async ({ user }) => {
            const run = runner(ctx);
            if (!run) return;
            const refused = await run.runMutation(internal.access.takeNewTeam, {
              userId: user.id,
            });
            if (refused) throw new APIError("TOO_MANY_REQUESTS", { message: refused });
          },
          // On the hosted edition a new team starts its free trial (no card asked for).
          // It is its owner's trial: a person who had one already doesn't get fresh days.
          afterCreateOrganization: async ({ organization, user }) => {
            if (!isMutationCtx(ctx) && !isActionCtx(ctx)) return;
            await ctx.scheduler.runAfter(0, internal.trial.begin, {
              organizationId: organization.id,
              ownerId: user.id,
              ownerEmail: user.email,
            });
            // Every new team starts on the toolkit the operator lends, when there is one,
            // so setting up never asks about a toolkit. Its own can be set in Settings.
            await ctx.scheduler.runAfter(0, internal.toolkitConnections.lendOurs, {
              organizationId: organization.id,
              userId: user.id,
            });
            // A welcome for someone's first team, a few seconds on so it can say how long
            // the trial (started just above) runs.
            await ctx.scheduler.runAfter(5_000, internal.email.sendWelcome, {
              organizationId: organization.id,
              userId: user.id,
            });
          },
          // Better Auth has deleted the team, its members and invitations; everything
          // else it made (automations, files, runs, outputs, uploads in storage) goes in
          // the background (teamDeletion.ts).
          afterDeleteOrganization: async ({ organization, user }) => {
            const run = runner(ctx);
            if (!run) return;
            await run.runMutation(internal.teamDeletion.begin, {
              organizationId: organization.id,
              name: organization.name,
              by: user.id,
              reason: "team",
            });
          },
        },
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
      // Signs agents' access tokens (mcp() below), and publishes their keys at /jwks.
      jwt({ disableSettingJwtHeader: true, jwt: { issuer: agentIssuer() } }),
      // Sign-in for AI agents (MCP clients): OAuth 2.1 with PKCE, for the MCP server at
      // CONVEX_SITE_URL/mcp. lib/agentSignIn.ts explains the pieces.
      mcp({
        // Signed out, the person signs in from the team page and comes back to it.
        loginPage: "/connect/team",
        consentPage: "/connect",
        resource: mcpResource(),
        scopes: AGENT_SCOPES,
        accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
        // A refresh token works once. A second use means someone holds a copy, and stops
        // every token from that sign-in: the agent has to sign in again.
        refreshTokenReuseInterval: 0,
        // Agents that can't name themselves with a metadata document (ChatGPT, many
        // desktop apps) register on the spot, as they could before.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        clientRegistrationDefaultScopes: AGENT_SCOPES,
        // A token works on one team. The person picks it at /connect/team each time an
        // agent connects; the choice is the consent's reference.
        postLogin: {
          page: "/connect/team",
          shouldRedirect: async ({ user, session, isContinuation }) => {
            const run = runner(ctx);
            const team = session.activeOrganizationId as string | null | undefined;
            const onIt =
              team && run
                ? await run.runQuery(components.betterAuth.members.roleFor, {
                    userId: user.id,
                    organizationId: team,
                  })
                : null;
            return !onIt || !isContinuation;
          },
          consentReferenceId: ({ session }) => {
            const team = session.activeOrganizationId as string | null | undefined;
            if (!team) throw new APIError("BAD_REQUEST", { message: "Pick a team first." });
            return team;
          },
        },
        // Every token, new or refreshed, names its team, and only while the person is
        // still on it: someone who left the team gets no more tokens for it.
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user || !referenceId) return {};
          const run = runner(ctx);
          if (run) {
            const role = await run.runQuery(components.betterAuth.members.roleFor, {
              userId: user.id,
              organizationId: referenceId,
            });
            if (!role) {
              throw new APIError("FORBIDDEN", { message: "You are no longer on this team." });
            }
          }
          return { [TEAM_CLAIM]: referenceId };
        },
      }),
      // Agents named by the address of their own metadata document (claude.ai, VS Code).
      cimd({
        fetchClientMetadataResource: fetchClientMetadata,
        metadataProfile: "mcp-2026-07-28",
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
