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
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_edition from "../lib/edition.js";
import type * as lib_exports from "../lib/exports.js";
import type * as lib_outputs from "../lib/outputs.js";
import type * as lib_queue from "../lib/queue.js";
import type * as lib_runner from "../lib/runner.js";
import type * as lib_s3 from "../lib/s3.js";
import type * as runs from "../runs.js";
import type * as settings from "../settings.js";
import type * as storage from "../storage.js";
import type * as teamSettings from "../teamSettings.js";
import type * as teams from "../teams.js";
import type * as toolkitConnections from "../toolkitConnections.js";
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
  crons: typeof crons;
  files: typeof files;
  http: typeof http;
  jobs: typeof jobs;
  "lib/authz": typeof lib_authz;
  "lib/crypto": typeof lib_crypto;
  "lib/edition": typeof lib_edition;
  "lib/exports": typeof lib_exports;
  "lib/outputs": typeof lib_outputs;
  "lib/queue": typeof lib_queue;
  "lib/runner": typeof lib_runner;
  "lib/s3": typeof lib_s3;
  runs: typeof runs;
  settings: typeof settings;
  storage: typeof storage;
  teamSettings: typeof teamSettings;
  teams: typeof teams;
  toolkitConnections: typeof toolkitConnections;
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
};
