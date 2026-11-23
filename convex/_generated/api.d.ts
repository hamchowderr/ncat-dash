/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as agentScreen from "../agentScreen.js";
import type * as aiSpend from "../aiSpend.js";
import type * as alerts from "../alerts.js";
import type * as anthropicKey from "../anthropicKey.js";
import type * as auth from "../auth.js";
import type * as automationFolders from "../automationFolders.js";
import type * as automations from "../automations.js";
import type * as blocks from "../blocks.js";
import type * as broll from "../broll.js";
import type * as calendar from "../calendar.js";
import type * as captionTranslation from "../captionTranslation.js";
import type * as chatAlertPresses from "../chatAlertPresses.js";
import type * as chatAlerts from "../chatAlerts.js";
import type * as clients from "../clients.js";
import type * as contentGoals from "../contentGoals.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as disclosure from "../disclosure.js";
import type * as discord from "../discord.js";
import type * as discordReview from "../discordReview.js";
import type * as dropbox from "../dropbox.js";
import type * as email from "../email.js";
import type * as files from "../files.js";
import type * as footage from "../footage.js";
import type * as googleMeet from "../googleMeet.js";
import type * as home from "../home.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_adFiles from "../lib/adFiles.js";
import type * as lib_agentToken from "../lib/agentToken.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_approvals from "../lib/approvals.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_brand from "../lib/brand.js";
import type * as lib_broll from "../lib/broll.js";
import type * as lib_bucket from "../lib/bucket.js";
import type * as lib_caller from "../lib/caller.js";
import type * as lib_captions from "../lib/captions.js";
import type * as lib_chain from "../lib/chain.js";
import type * as lib_chatAlerts_chatFormats from "../lib/chatAlerts/chatFormats.js";
import type * as lib_chatAlerts_discord from "../lib/chatAlerts/discord.js";
import type * as lib_chatAlerts_index from "../lib/chatAlerts/index.js";
import type * as lib_chatAlerts_slack from "../lib/chatAlerts/slack.js";
import type * as lib_chatAlerts_teams from "../lib/chatAlerts/teams.js";
import type * as lib_chatAlerts_telegram from "../lib/chatAlerts/telegram.js";
import type * as lib_cleanup from "../lib/cleanup.js";
import type * as lib_clientIp from "../lib/clientIp.js";
import type * as lib_clientLinks from "../lib/clientLinks.js";
import type * as lib_clients from "../lib/clients.js";
import type * as lib_creatorRights from "../lib/creatorRights.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_disclosure from "../lib/disclosure.js";
import type * as lib_discordApi from "../lib/discordApi.js";
import type * as lib_discordPosts from "../lib/discordPosts.js";
import type * as lib_disposableDomains from "../lib/disposableDomains.js";
import type * as lib_drawing from "../lib/drawing.js";
import type * as lib_dropbox from "../lib/dropbox.js";
import type * as lib_edition from "../lib/edition.js";
import type * as lib_emailKey from "../lib/emailKey.js";
import type * as lib_exports from "../lib/exports.js";
import type * as lib_facts from "../lib/facts.js";
import type * as lib_footage from "../lib/footage.js";
import type * as lib_googleMeet from "../lib/googleMeet.js";
import type * as lib_hooks from "../lib/hooks.js";
import type * as lib_items from "../lib/items.js";
import type * as lib_knownWords from "../lib/knownWords.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_logic from "../lib/logic.js";
import type * as lib_looks from "../lib/looks.js";
import type * as lib_mcpContent from "../lib/mcpContent.js";
import type * as lib_mcpKeys from "../lib/mcpKeys.js";
import type * as lib_mcpServer from "../lib/mcpServer.js";
import type * as lib_microsoft from "../lib/microsoft.js";
import type * as lib_moments from "../lib/moments.js";
import type * as lib_motion from "../lib/motion.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_oauth from "../lib/oauth.js";
import type * as lib_outputs from "../lib/outputs.js";
import type * as lib_packages from "../lib/packages.js";
import type * as lib_pickUp from "../lib/pickUp.js";
import type * as lib_pools from "../lib/pools.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_queue from "../lib/queue.js";
import type * as lib_reviewChannels from "../lib/reviewChannels.js";
import type * as lib_reviewSpeaker from "../lib/reviewSpeaker.js";
import type * as lib_reviews from "../lib/reviews.js";
import type * as lib_runLimit from "../lib/runLimit.js";
import type * as lib_runner from "../lib/runner.js";
import type * as lib_send from "../lib/send.js";
import type * as lib_signUps from "../lib/signUps.js";
import type * as lib_slackApi from "../lib/slackApi.js";
import type * as lib_slackPosts from "../lib/slackPosts.js";
import type * as lib_slackSignature from "../lib/slackSignature.js";
import type * as lib_stepLog from "../lib/stepLog.js";
import type * as lib_storyboard from "../lib/storyboard.js";
import type * as lib_storyboards from "../lib/storyboards.js";
import type * as lib_subtitles from "../lib/subtitles.js";
import type * as lib_teamSteps from "../lib/teamSteps.js";
import type * as lib_teamsApp from "../lib/teamsApp.js";
import type * as lib_teamsPosts from "../lib/teamsPosts.js";
import type * as lib_telegramPosts from "../lib/telegramPosts.js";
import type * as lib_toolkitMessage from "../lib/toolkitMessage.js";
import type * as lib_tours from "../lib/tours.js";
import type * as lib_trial from "../lib/trial.js";
import type * as lib_triggers from "../lib/triggers.js";
import type * as lib_typing from "../lib/typing.js";
import type * as lib_versions from "../lib/versions.js";
import type * as lib_workflows from "../lib/workflows.js";
import type * as lib_zoom from "../lib/zoom.js";
import type * as library from "../library.js";
import type * as links from "../links.js";
import type * as looks from "../looks.js";
import type * as mcp from "../mcp.js";
import type * as mcpKeys from "../mcpKeys.js";
import type * as microsoft from "../microsoft.js";
import type * as microsoftTeams from "../microsoftTeams.js";
import type * as microsoftTeamsChat from "../microsoftTeamsChat.js";
import type * as microsoftTeamsReview from "../microsoftTeamsReview.js";
import type * as moments from "../moments.js";
import type * as motion from "../motion.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as outputs from "../outputs.js";
import type * as portal from "../portal.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";
import type * as reviewAgent from "../reviewAgent.js";
import type * as reviewShares from "../reviewShares.js";
import type * as reviews from "../reviews.js";
import type * as runs from "../runs.js";
import type * as send from "../send.js";
import type * as settings from "../settings.js";
import type * as sharedPresence from "../sharedPresence.js";
import type * as sharedReview from "../sharedReview.js";
import type * as slack from "../slack.js";
import type * as slackReview from "../slackReview.js";
import type * as storage from "../storage.js";
import type * as storyboards from "../storyboards.js";
import type * as stuck from "../stuck.js";
import type * as subtitleTranslation from "../subtitleTranslation.js";
import type * as teamSettings from "../teamSettings.js";
import type * as teamSteps from "../teamSteps.js";
import type * as teams from "../teams.js";
import type * as telegram from "../telegram.js";
import type * as telegramReview from "../telegramReview.js";
import type * as toolkitConnections from "../toolkitConnections.js";
import type * as toolkitHealth from "../toolkitHealth.js";
import type * as tours from "../tours.js";
import type * as translations from "../translations.js";
import type * as trial from "../trial.js";
import type * as versions from "../versions.js";
import type * as videoCookies from "../videoCookies.js";
import type * as voiceNotes from "../voiceNotes.js";
import type * as watch from "../watch.js";
import type * as workflows from "../workflows.js";
import type * as zoom from "../zoom.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  agentScreen: typeof agentScreen;
  aiSpend: typeof aiSpend;
  alerts: typeof alerts;
  anthropicKey: typeof anthropicKey;
  auth: typeof auth;
  automationFolders: typeof automationFolders;
  automations: typeof automations;
  blocks: typeof blocks;
  broll: typeof broll;
  calendar: typeof calendar;
  captionTranslation: typeof captionTranslation;
  chatAlertPresses: typeof chatAlertPresses;
  chatAlerts: typeof chatAlerts;
  clients: typeof clients;
  contentGoals: typeof contentGoals;
  creators: typeof creators;
  crons: typeof crons;
  disclosure: typeof disclosure;
  discord: typeof discord;
  discordReview: typeof discordReview;
  dropbox: typeof dropbox;
  email: typeof email;
  files: typeof files;
  footage: typeof footage;
  googleMeet: typeof googleMeet;
  home: typeof home;
  hooks: typeof hooks;
  http: typeof http;
  jobs: typeof jobs;
  "lib/access": typeof lib_access;
  "lib/adFiles": typeof lib_adFiles;
  "lib/agentToken": typeof lib_agentToken;
  "lib/alerts": typeof lib_alerts;
  "lib/approvals": typeof lib_approvals;
  "lib/authz": typeof lib_authz;
  "lib/brand": typeof lib_brand;
  "lib/broll": typeof lib_broll;
  "lib/bucket": typeof lib_bucket;
  "lib/caller": typeof lib_caller;
  "lib/captions": typeof lib_captions;
  "lib/chain": typeof lib_chain;
  "lib/chatAlerts/chatFormats": typeof lib_chatAlerts_chatFormats;
  "lib/chatAlerts/discord": typeof lib_chatAlerts_discord;
  "lib/chatAlerts/index": typeof lib_chatAlerts_index;
  "lib/chatAlerts/slack": typeof lib_chatAlerts_slack;
  "lib/chatAlerts/teams": typeof lib_chatAlerts_teams;
  "lib/chatAlerts/telegram": typeof lib_chatAlerts_telegram;
  "lib/cleanup": typeof lib_cleanup;
  "lib/clientIp": typeof lib_clientIp;
  "lib/clientLinks": typeof lib_clientLinks;
  "lib/clients": typeof lib_clients;
  "lib/creatorRights": typeof lib_creatorRights;
  "lib/crypto": typeof lib_crypto;
  "lib/disclosure": typeof lib_disclosure;
  "lib/discordApi": typeof lib_discordApi;
  "lib/discordPosts": typeof lib_discordPosts;
  "lib/disposableDomains": typeof lib_disposableDomains;
  "lib/drawing": typeof lib_drawing;
  "lib/dropbox": typeof lib_dropbox;
  "lib/edition": typeof lib_edition;
  "lib/emailKey": typeof lib_emailKey;
  "lib/exports": typeof lib_exports;
  "lib/facts": typeof lib_facts;
  "lib/footage": typeof lib_footage;
  "lib/googleMeet": typeof lib_googleMeet;
  "lib/hooks": typeof lib_hooks;
  "lib/items": typeof lib_items;
  "lib/knownWords": typeof lib_knownWords;
  "lib/library": typeof lib_library;
  "lib/limits": typeof lib_limits;
  "lib/logic": typeof lib_logic;
  "lib/looks": typeof lib_looks;
  "lib/mcpContent": typeof lib_mcpContent;
  "lib/mcpKeys": typeof lib_mcpKeys;
  "lib/mcpServer": typeof lib_mcpServer;
  "lib/microsoft": typeof lib_microsoft;
  "lib/moments": typeof lib_moments;
  "lib/motion": typeof lib_motion;
  "lib/notifications": typeof lib_notifications;
  "lib/oauth": typeof lib_oauth;
  "lib/outputs": typeof lib_outputs;
  "lib/packages": typeof lib_packages;
  "lib/pickUp": typeof lib_pickUp;
  "lib/pools": typeof lib_pools;
  "lib/projects": typeof lib_projects;
  "lib/queue": typeof lib_queue;
  "lib/reviewChannels": typeof lib_reviewChannels;
  "lib/reviewSpeaker": typeof lib_reviewSpeaker;
  "lib/reviews": typeof lib_reviews;
  "lib/runLimit": typeof lib_runLimit;
  "lib/runner": typeof lib_runner;
  "lib/send": typeof lib_send;
  "lib/signUps": typeof lib_signUps;
  "lib/slackApi": typeof lib_slackApi;
  "lib/slackPosts": typeof lib_slackPosts;
  "lib/slackSignature": typeof lib_slackSignature;
  "lib/stepLog": typeof lib_stepLog;
  "lib/storyboard": typeof lib_storyboard;
  "lib/storyboards": typeof lib_storyboards;
  "lib/subtitles": typeof lib_subtitles;
  "lib/teamSteps": typeof lib_teamSteps;
  "lib/teamsApp": typeof lib_teamsApp;
  "lib/teamsPosts": typeof lib_teamsPosts;
  "lib/telegramPosts": typeof lib_telegramPosts;
  "lib/toolkitMessage": typeof lib_toolkitMessage;
  "lib/tours": typeof lib_tours;
  "lib/trial": typeof lib_trial;
  "lib/triggers": typeof lib_triggers;
  "lib/typing": typeof lib_typing;
  "lib/versions": typeof lib_versions;
  "lib/workflows": typeof lib_workflows;
  "lib/zoom": typeof lib_zoom;
  library: typeof library;
  links: typeof links;
  looks: typeof looks;
  mcp: typeof mcp;
  mcpKeys: typeof mcpKeys;
  microsoft: typeof microsoft;
  microsoftTeams: typeof microsoftTeams;
  microsoftTeamsChat: typeof microsoftTeamsChat;
  microsoftTeamsReview: typeof microsoftTeamsReview;
  moments: typeof moments;
  motion: typeof motion;
  notes: typeof notes;
  notifications: typeof notifications;
  oauth: typeof oauth;
  outputs: typeof outputs;
  portal: typeof portal;
  presence: typeof presence;
  projects: typeof projects;
  reviewAgent: typeof reviewAgent;
  reviewShares: typeof reviewShares;
  reviews: typeof reviews;
  runs: typeof runs;
  send: typeof send;
  settings: typeof settings;
  sharedPresence: typeof sharedPresence;
  sharedReview: typeof sharedReview;
  slack: typeof slack;
  slackReview: typeof slackReview;
  storage: typeof storage;
  storyboards: typeof storyboards;
  stuck: typeof stuck;
  subtitleTranslation: typeof subtitleTranslation;
  teamSettings: typeof teamSettings;
  teamSteps: typeof teamSteps;
  teams: typeof teams;
  telegram: typeof telegram;
  telegramReview: typeof telegramReview;
  toolkitConnections: typeof toolkitConnections;
  toolkitHealth: typeof toolkitHealth;
  tours: typeof tours;
  translations: typeof translations;
  trial: typeof trial;
  versions: typeof versions;
  videoCookies: typeof videoCookies;
  voiceNotes: typeof voiceNotes;
  watch: typeof watch;
  workflows: typeof workflows;
  zoom: typeof zoom;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  outboundPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"outboundPool">;
  toolkitPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"toolkitPool">;
  backgroundPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"backgroundPool">;
};
