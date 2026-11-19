/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as auth from "../auth.js";
import type * as automations from "../automations.js";
import type * as clients from "../clients.js";
import type * as crons from "../crons.js";
import type * as discord from "../discord.js";
import type * as email from "../email.js";
import type * as files from "../files.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_agentToken from "../lib/agentToken.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_approvals from "../lib/approvals.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_brand from "../lib/brand.js";
import type * as lib_bucket from "../lib/bucket.js";
import type * as lib_captions from "../lib/captions.js";
import type * as lib_chain from "../lib/chain.js";
import type * as lib_clients from "../lib/clients.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_drawing from "../lib/drawing.js";
import type * as lib_edition from "../lib/edition.js";
import type * as lib_exports from "../lib/exports.js";
import type * as lib_facts from "../lib/facts.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_logic from "../lib/logic.js";
import type * as lib_moments from "../lib/moments.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_outputs from "../lib/outputs.js";
import type * as lib_packages from "../lib/packages.js";
import type * as lib_pickUp from "../lib/pickUp.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_queue from "../lib/queue.js";
import type * as lib_reviews from "../lib/reviews.js";
import type * as lib_runner from "../lib/runner.js";
import type * as lib_slackApi from "../lib/slackApi.js";
import type * as lib_slackPosts from "../lib/slackPosts.js";
import type * as lib_teamSteps from "../lib/teamSteps.js";
import type * as lib_toolkitMessage from "../lib/toolkitMessage.js";
import type * as lib_typing from "../lib/typing.js";
import type * as lib_versions from "../lib/versions.js";
import type * as library from "../library.js";
import type * as moments from "../moments.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as outputs from "../outputs.js";
import type * as portal from "../portal.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";
import type * as reviewAgent from "../reviewAgent.js";
import type * as reviewShares from "../reviewShares.js";
import type * as reviews from "../reviews.js";
import type * as runs from "../runs.js";
import type * as settings from "../settings.js";
import type * as sharedPresence from "../sharedPresence.js";
import type * as sharedReview from "../sharedReview.js";
import type * as slack from "../slack.js";
import type * as slackReview from "../slackReview.js";
import type * as storage from "../storage.js";
import type * as teamSettings from "../teamSettings.js";
import type * as teamSteps from "../teamSteps.js";
import type * as teams from "../teams.js";
import type * as toolkitConnections from "../toolkitConnections.js";
import type * as toolkitHealth from "../toolkitHealth.js";
import type * as versions from "../versions.js";
import type * as voiceNotes from "../voiceNotes.js";
import type * as watch from "../watch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  auth: typeof auth;
  automations: typeof automations;
  clients: typeof clients;
  crons: typeof crons;
  discord: typeof discord;
  email: typeof email;
  files: typeof files;
  home: typeof home;
  http: typeof http;
  jobs: typeof jobs;
  "lib/agentToken": typeof lib_agentToken;
  "lib/alerts": typeof lib_alerts;
  "lib/approvals": typeof lib_approvals;
  "lib/authz": typeof lib_authz;
  "lib/brand": typeof lib_brand;
  "lib/bucket": typeof lib_bucket;
  "lib/captions": typeof lib_captions;
  "lib/chain": typeof lib_chain;
  "lib/clients": typeof lib_clients;
  "lib/crypto": typeof lib_crypto;
  "lib/drawing": typeof lib_drawing;
  "lib/edition": typeof lib_edition;
  "lib/exports": typeof lib_exports;
  "lib/facts": typeof lib_facts;
  "lib/library": typeof lib_library;
  "lib/logic": typeof lib_logic;
  "lib/moments": typeof lib_moments;
  "lib/notifications": typeof lib_notifications;
  "lib/outputs": typeof lib_outputs;
  "lib/packages": typeof lib_packages;
  "lib/pickUp": typeof lib_pickUp;
  "lib/projects": typeof lib_projects;
  "lib/queue": typeof lib_queue;
  "lib/reviews": typeof lib_reviews;
  "lib/runner": typeof lib_runner;
  "lib/slackApi": typeof lib_slackApi;
  "lib/slackPosts": typeof lib_slackPosts;
  "lib/teamSteps": typeof lib_teamSteps;
  "lib/toolkitMessage": typeof lib_toolkitMessage;
  "lib/typing": typeof lib_typing;
  "lib/versions": typeof lib_versions;
  library: typeof library;
  moments: typeof moments;
  notes: typeof notes;
  notifications: typeof notifications;
  outputs: typeof outputs;
  portal: typeof portal;
  presence: typeof presence;
  projects: typeof projects;
  reviewAgent: typeof reviewAgent;
  reviewShares: typeof reviewShares;
  reviews: typeof reviews;
  runs: typeof runs;
  settings: typeof settings;
  sharedPresence: typeof sharedPresence;
  sharedReview: typeof sharedReview;
  slack: typeof slack;
  slackReview: typeof slackReview;
  storage: typeof storage;
  teamSettings: typeof teamSettings;
  teamSteps: typeof teamSteps;
  teams: typeof teams;
  toolkitConnections: typeof toolkitConnections;
  toolkitHealth: typeof toolkitHealth;
  versions: typeof versions;
  voiceNotes: typeof voiceNotes;
  watch: typeof watch;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
