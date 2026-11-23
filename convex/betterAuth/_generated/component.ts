/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    adapter: {
      consumeOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClient";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthRefreshToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientAssertion";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
        },
        any,
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                data: {
                  createdAt: number;
                  email: string;
                  emailVerified: boolean;
                  image?: null | string;
                  name: string;
                  updatedAt: number;
                  userId?: null | string;
                };
                model: "user";
              }
            | {
                data: {
                  activeOrganizationId?: null | string;
                  createdAt: number;
                  expiresAt: number;
                  ipAddress?: null | string;
                  token: string;
                  updatedAt: number;
                  userAgent?: null | string;
                  userId: string;
                };
                model: "session";
              }
            | {
                data: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId: string;
                  createdAt: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt: number;
                  userId: string;
                };
                model: "account";
              }
            | {
                data: {
                  createdAt: number;
                  expiresAt: number;
                  identifier: string;
                  updatedAt: number;
                  value: string;
                };
                model: "verification";
              }
            | {
                data: {
                  createdAt: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name: string;
                  slug: string;
                };
                model: "organization";
              }
            | {
                data: {
                  createdAt: number;
                  organizationId: string;
                  role: string;
                  userId: string;
                };
                model: "member";
              }
            | {
                data: {
                  createdAt: number;
                  email: string;
                  expiresAt: number;
                  inviterId: string;
                  organizationId: string;
                  role?: null | string;
                  status: string;
                };
                model: "invitation";
              }
            | {
                data: {
                  alg?: null | string;
                  createdAt: number;
                  crv?: null | string;
                  expiresAt?: null | number;
                  privateKey: string;
                  publicKey: string;
                };
                model: "jwks";
              }
            | {
                data: {
                  applicationType?: null | string;
                  backchannelLogoutSessionRequired?: null | boolean;
                  backchannelLogoutUri?: null | string;
                  clientCredentialsScopes?: null | Array<string>;
                  clientDiscoveryId?: null | string;
                  clientId: string;
                  clientSecret?: null | string;
                  contacts?: null | Array<string>;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  dpopBoundAccessTokens?: null | boolean;
                  enableEndSession?: null | boolean;
                  grantTypes?: null | Array<string>;
                  icon?: null | string;
                  jwks?: null | string;
                  jwksUri?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  policy?: null | string;
                  postLogoutRedirectUris?: null | Array<string>;
                  redirectUris: Array<string>;
                  referenceId?: null | string;
                  requirePKCE?: null | boolean;
                  responseTypes?: null | Array<string>;
                  scopes?: null | Array<string>;
                  skipConsent?: null | boolean;
                  softwareId?: null | string;
                  softwareStatement?: null | string;
                  softwareVersion?: null | string;
                  subjectType?: null | string;
                  tokenEndpointAuthMethod?: null | string;
                  tos?: null | string;
                  updatedAt?: null | number;
                  uri?: null | string;
                  userId?: null | string;
                };
                model: "oauthClient";
              }
            | {
                data: {
                  accessTokenTtl?: null | number;
                  allowedScopes?: null | Array<string>;
                  createdAt?: null | number;
                  customClaims?: null | string;
                  disabled?: null | boolean;
                  dpopBoundAccessTokensRequired?: null | boolean;
                  identifier: string;
                  metadata?: null | string;
                  name: string;
                  policyVersion?: null | number;
                  refreshTokenTtl?: null | number;
                  signingAlgorithm?: null | string;
                  signingKeyId?: null | string;
                  updatedAt?: null | number;
                };
                model: "oauthResource";
              }
            | {
                data: {
                  clientId: string;
                  createdAt?: null | number;
                  metadata?: null | string;
                  resourceId: string;
                };
                model: "oauthClientResource";
              }
            | {
                data: {
                  authTime?: null | number;
                  authorizationCodeId?: null | string;
                  clientId: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  rotatedAt?: null | number;
                  rotationReplayExpiresAt?: null | number;
                  rotationReplayResponse?: null | string;
                  scopes: Array<string>;
                  sessionId?: null | string;
                  token: string;
                  userId: string;
                };
                model: "oauthRefreshToken";
              }
            | {
                data: {
                  authorizationCodeId?: null | string;
                  clientId: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  refreshId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  scopes: Array<string>;
                  sessionId?: null | string;
                  token?: null | string;
                  userId?: null | string;
                };
                model: "oauthAccessToken";
              }
            | {
                data: {
                  clientId: string;
                  createdAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  scopes: Array<string>;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                model: "oauthConsent";
              }
            | { data: { expiresAt: number }; model: "oauthClientAssertion" };
          onCreateHandle?: string;
          select?: Array<string>;
          unique?: Array<string>;
        },
        any,
        Name
      >;
      deleteMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClient";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthRefreshToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientAssertion";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      deleteOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClient";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientResource";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthRefreshToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientAssertion";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
        },
        any,
        Name
      >;
      findMany: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          limit?: number;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "organization"
            | "member"
            | "invitation"
            | "jwks"
            | "oauthClient"
            | "oauthResource"
            | "oauthClientResource"
            | "oauthRefreshToken"
            | "oauthAccessToken"
            | "oauthConsent"
            | "oauthClientAssertion";
          offset?: number;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          select?: Array<string>;
          sortBy?: { direction: "asc" | "desc"; field: string };
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        any,
        Name
      >;
      findOne: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "organization"
            | "member"
            | "invitation"
            | "jwks"
            | "oauthClient"
            | "oauthResource"
            | "oauthClientResource"
            | "oauthRefreshToken"
            | "oauthAccessToken"
            | "oauthConsent"
            | "oauthClientAssertion";
          select?: Array<string>;
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        any,
        Name
      >;
      incrementOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                increment: Record<string, number>;
                model: "user";
                set?: {
                  createdAt?: number;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  name?: string;
                  updatedAt?: number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "session";
                set?: {
                  activeOrganizationId?: null | string;
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "account";
                set?: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "verification";
                set?: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "organization";
                set?: {
                  createdAt?: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "member";
                set?: {
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "invitation";
                set?: {
                  createdAt?: number;
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "jwks";
                set?: {
                  alg?: null | string;
                  createdAt?: number;
                  crv?: null | string;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthClient";
                set?: {
                  applicationType?: null | string;
                  backchannelLogoutSessionRequired?: null | boolean;
                  backchannelLogoutUri?: null | string;
                  clientCredentialsScopes?: null | Array<string>;
                  clientDiscoveryId?: null | string;
                  clientId?: string;
                  clientSecret?: null | string;
                  contacts?: null | Array<string>;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  dpopBoundAccessTokens?: null | boolean;
                  enableEndSession?: null | boolean;
                  grantTypes?: null | Array<string>;
                  icon?: null | string;
                  jwks?: null | string;
                  jwksUri?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  policy?: null | string;
                  postLogoutRedirectUris?: null | Array<string>;
                  redirectUris?: Array<string>;
                  referenceId?: null | string;
                  requirePKCE?: null | boolean;
                  responseTypes?: null | Array<string>;
                  scopes?: null | Array<string>;
                  skipConsent?: null | boolean;
                  softwareId?: null | string;
                  softwareStatement?: null | string;
                  softwareVersion?: null | string;
                  subjectType?: null | string;
                  tokenEndpointAuthMethod?: null | string;
                  tos?: null | string;
                  updatedAt?: null | number;
                  uri?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthResource";
                set?: {
                  accessTokenTtl?: null | number;
                  allowedScopes?: null | Array<string>;
                  createdAt?: null | number;
                  customClaims?: null | string;
                  disabled?: null | boolean;
                  dpopBoundAccessTokensRequired?: null | boolean;
                  identifier?: string;
                  metadata?: null | string;
                  name?: string;
                  policyVersion?: null | number;
                  refreshTokenTtl?: null | number;
                  signingAlgorithm?: null | string;
                  signingKeyId?: null | string;
                  updatedAt?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthClientResource";
                set?: {
                  clientId?: string;
                  createdAt?: null | number;
                  metadata?: null | string;
                  resourceId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthRefreshToken";
                set?: {
                  authTime?: null | number;
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  rotatedAt?: null | number;
                  rotationReplayExpiresAt?: null | number;
                  rotationReplayResponse?: null | string;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthAccessToken";
                set?: {
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  refreshId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthConsent";
                set?: {
                  clientId?: string;
                  createdAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  scopes?: Array<string>;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                increment: Record<string, number>;
                model: "oauthClientAssertion";
                set?: { expiresAt?: number };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
        },
        any,
        Name
      >;
      updateMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  createdAt?: number;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  name?: string;
                  updatedAt?: number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  createdAt?: number;
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  alg?: null | string;
                  createdAt?: number;
                  crv?: null | string;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClient";
                update: {
                  applicationType?: null | string;
                  backchannelLogoutSessionRequired?: null | boolean;
                  backchannelLogoutUri?: null | string;
                  clientCredentialsScopes?: null | Array<string>;
                  clientDiscoveryId?: null | string;
                  clientId?: string;
                  clientSecret?: null | string;
                  contacts?: null | Array<string>;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  dpopBoundAccessTokens?: null | boolean;
                  enableEndSession?: null | boolean;
                  grantTypes?: null | Array<string>;
                  icon?: null | string;
                  jwks?: null | string;
                  jwksUri?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  policy?: null | string;
                  postLogoutRedirectUris?: null | Array<string>;
                  redirectUris?: Array<string>;
                  referenceId?: null | string;
                  requirePKCE?: null | boolean;
                  responseTypes?: null | Array<string>;
                  scopes?: null | Array<string>;
                  skipConsent?: null | boolean;
                  softwareId?: null | string;
                  softwareStatement?: null | string;
                  softwareVersion?: null | string;
                  subjectType?: null | string;
                  tokenEndpointAuthMethod?: null | string;
                  tos?: null | string;
                  updatedAt?: null | number;
                  uri?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthResource";
                update: {
                  accessTokenTtl?: null | number;
                  allowedScopes?: null | Array<string>;
                  createdAt?: null | number;
                  customClaims?: null | string;
                  disabled?: null | boolean;
                  dpopBoundAccessTokensRequired?: null | boolean;
                  identifier?: string;
                  metadata?: null | string;
                  name?: string;
                  policyVersion?: null | number;
                  refreshTokenTtl?: null | number;
                  signingAlgorithm?: null | string;
                  signingKeyId?: null | string;
                  updatedAt?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientResource";
                update: {
                  clientId?: string;
                  createdAt?: null | number;
                  metadata?: null | string;
                  resourceId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthRefreshToken";
                update: {
                  authTime?: null | number;
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  rotatedAt?: null | number;
                  rotationReplayExpiresAt?: null | number;
                  rotationReplayResponse?: null | string;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                update: {
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  refreshId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                update: {
                  clientId?: string;
                  createdAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  scopes?: Array<string>;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientAssertion";
                update: { expiresAt?: number };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      updateOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  createdAt?: number;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  name?: string;
                  updatedAt?: number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "userId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  createdAt?: number;
                  expiresAt?: number;
                  ipAddress?: null | string;
                  token?: string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "activeOrganizationId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "name" | "slug" | "logo" | "createdAt" | "metadata" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    "organizationId" | "userId" | "role" | "createdAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  createdAt?: number;
                  email?: string;
                  expiresAt?: number;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "createdAt"
                    | "inviterId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  alg?: null | string;
                  createdAt?: number;
                  crv?: null | string;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "alg"
                    | "crv"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClient";
                update: {
                  applicationType?: null | string;
                  backchannelLogoutSessionRequired?: null | boolean;
                  backchannelLogoutUri?: null | string;
                  clientCredentialsScopes?: null | Array<string>;
                  clientDiscoveryId?: null | string;
                  clientId?: string;
                  clientSecret?: null | string;
                  contacts?: null | Array<string>;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  dpopBoundAccessTokens?: null | boolean;
                  enableEndSession?: null | boolean;
                  grantTypes?: null | Array<string>;
                  icon?: null | string;
                  jwks?: null | string;
                  jwksUri?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  policy?: null | string;
                  postLogoutRedirectUris?: null | Array<string>;
                  redirectUris?: Array<string>;
                  referenceId?: null | string;
                  requirePKCE?: null | boolean;
                  responseTypes?: null | Array<string>;
                  scopes?: null | Array<string>;
                  skipConsent?: null | boolean;
                  softwareId?: null | string;
                  softwareStatement?: null | string;
                  softwareVersion?: null | string;
                  subjectType?: null | string;
                  tokenEndpointAuthMethod?: null | string;
                  tos?: null | string;
                  updatedAt?: null | number;
                  uri?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "clientSecret"
                    | "clientDiscoveryId"
                    | "disabled"
                    | "skipConsent"
                    | "enableEndSession"
                    | "subjectType"
                    | "scopes"
                    | "clientCredentialsScopes"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "name"
                    | "uri"
                    | "icon"
                    | "contacts"
                    | "tos"
                    | "policy"
                    | "softwareId"
                    | "softwareVersion"
                    | "softwareStatement"
                    | "redirectUris"
                    | "postLogoutRedirectUris"
                    | "backchannelLogoutUri"
                    | "backchannelLogoutSessionRequired"
                    | "tokenEndpointAuthMethod"
                    | "applicationType"
                    | "jwks"
                    | "jwksUri"
                    | "grantTypes"
                    | "responseTypes"
                    | "requirePKCE"
                    | "dpopBoundAccessTokens"
                    | "referenceId"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthResource";
                update: {
                  accessTokenTtl?: null | number;
                  allowedScopes?: null | Array<string>;
                  createdAt?: null | number;
                  customClaims?: null | string;
                  disabled?: null | boolean;
                  dpopBoundAccessTokensRequired?: null | boolean;
                  identifier?: string;
                  metadata?: null | string;
                  name?: string;
                  policyVersion?: null | number;
                  refreshTokenTtl?: null | number;
                  signingAlgorithm?: null | string;
                  signingKeyId?: null | string;
                  updatedAt?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "name"
                    | "accessTokenTtl"
                    | "refreshTokenTtl"
                    | "signingAlgorithm"
                    | "signingKeyId"
                    | "allowedScopes"
                    | "customClaims"
                    | "dpopBoundAccessTokensRequired"
                    | "disabled"
                    | "createdAt"
                    | "updatedAt"
                    | "policyVersion"
                    | "metadata"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientResource";
                update: {
                  clientId?: string;
                  createdAt?: null | number;
                  metadata?: null | string;
                  resourceId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "resourceId"
                    | "metadata"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthRefreshToken";
                update: {
                  authTime?: null | number;
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  rotatedAt?: null | number;
                  rotationReplayExpiresAt?: null | number;
                  rotationReplayResponse?: null | string;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "rotatedAt"
                    | "rotationReplayResponse"
                    | "rotationReplayExpiresAt"
                    | "authTime"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                update: {
                  authorizationCodeId?: null | string;
                  clientId?: string;
                  confirmation?: null | string;
                  createdAt?: null | number;
                  expiresAt?: null | number;
                  referenceId?: null | string;
                  refreshId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  revoked?: null | number;
                  scopes?: Array<string>;
                  sessionId?: null | string;
                  token?: null | string;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "token"
                    | "clientId"
                    | "sessionId"
                    | "userId"
                    | "referenceId"
                    | "authorizationCodeId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "refreshId"
                    | "expiresAt"
                    | "createdAt"
                    | "revoked"
                    | "confirmation"
                    | "scopes"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                update: {
                  clientId?: string;
                  createdAt?: null | number;
                  referenceId?: null | string;
                  requestedUserInfoClaims?: null | Array<string>;
                  resources?: null | Array<string>;
                  scopes?: Array<string>;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "referenceId"
                    | "resources"
                    | "requestedUserInfoClaims"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthClientAssertion";
                update: { expiresAt?: number };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "expiresAt" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
        },
        any,
        Name
      >;
    };
    agents: {
      consentFor: FunctionReference<
        "query",
        "internal",
        { clientId: string; organizationId: string; userId: string },
        null | { clientName: string; consentId: string },
        Name
      >;
      countForTeam: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        number,
        Name
      >;
      end: FunctionReference<
        "mutation",
        "internal",
        { consentId: string },
        null | { clientId: string; organizationId: string; userId: string },
        Name
      >;
      forTeam: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{
          clientId: string;
          clientName: string;
          consentId: string;
          createdAt: number;
          userId: string;
        }>,
        Name
      >;
    };
    members: {
      caller: FunctionReference<
        "query",
        "internal",
        { sessionId: string; userId: string },
        null | any,
        Name
      >;
      contact: FunctionReference<
        "query",
        "internal",
        { userId: string },
        null | { email: string; name: string },
        Name
      >;
      contactsFor: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        {
          members: Array<{
            email: string;
            name: string;
            role: string;
            userId: string;
          }>;
          teamName: null | string;
        },
        Name
      >;
      people: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{ id: string; image: null | string; name: string }>,
        Name
      >;
      peopleFor: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        {
          invitations: Array<{ email: string; id: string; role: string }>;
          members: Array<{
            email: string;
            id: string;
            name: string;
            role: string;
          }>;
        },
        Name
      >;
      roleFor: FunctionReference<
        "query",
        "internal",
        { organizationId: string; userId: string },
        null | string,
        Name
      >;
      signUpCheck: FunctionReference<
        "query",
        "internal",
        { email: string },
        { hasAccounts: boolean; invited: boolean },
        Name
      >;
      teamsFor: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{ id: string; name: string; role: string }>,
        Name
      >;
    };
  };
