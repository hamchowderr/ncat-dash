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
    tickets: {
      byNumber: FunctionReference<
        "query",
        "internal",
        { number: number },
        null | {
          _creationTime: number;
          _id: string;
          closedAt?: number;
          context?: Record<string, string>;
          customerUnread: boolean;
          lastMessageAt: number;
          lastPublicFrom: "customer" | "staff";
          messageCount: number;
          number: number;
          preview: string;
          requesterEmail: string;
          requesterId: string;
          requesterName: string;
          scope?: string;
          staffUnread: boolean;
          status: "open" | "closed";
          subject: string;
        },
        Name
      >;
      customerUnread: FunctionReference<
        "query",
        "internal",
        { requesterId: string },
        number,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { ticketId: string; withPrivate?: boolean },
        null | {
          messages: Array<{
            _creationTime: number;
            _id: string;
            authorId: string;
            authorName: string;
            body: string;
            from: "customer" | "staff";
            private: boolean;
            ticketId: string;
          }>;
          ticket: {
            _creationTime: number;
            _id: string;
            closedAt?: number;
            context?: Record<string, string>;
            customerUnread: boolean;
            lastMessageAt: number;
            lastPublicFrom: "customer" | "staff";
            messageCount: number;
            number: number;
            preview: string;
            requesterEmail: string;
            requesterId: string;
            requesterName: string;
            scope?: string;
            staffUnread: boolean;
            status: "open" | "closed";
            subject: string;
          };
        },
        Name
      >;
      listByRequester: FunctionReference<
        "query",
        "internal",
        { limit?: number; requesterId: string },
        Array<{
          _creationTime: number;
          _id: string;
          closedAt?: number;
          context?: Record<string, string>;
          customerUnread: boolean;
          lastMessageAt: number;
          lastPublicFrom: "customer" | "staff";
          messageCount: number;
          number: number;
          preview: string;
          requesterEmail: string;
          requesterId: string;
          requesterName: string;
          scope?: string;
          staffUnread: boolean;
          status: "open" | "closed";
          subject: string;
        }>,
        Name
      >;
      listByStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; status: "open" | "closed" },
        Array<{
          _creationTime: number;
          _id: string;
          closedAt?: number;
          context?: Record<string, string>;
          customerUnread: boolean;
          lastMessageAt: number;
          lastPublicFrom: "customer" | "staff";
          messageCount: number;
          number: number;
          preview: string;
          requesterEmail: string;
          requesterId: string;
          requesterName: string;
          scope?: string;
          staffUnread: boolean;
          status: "open" | "closed";
          subject: string;
        }>,
        Name
      >;
      markRead: FunctionReference<
        "mutation",
        "internal",
        { by: "customer" | "staff"; ticketId: string },
        null,
        Name
      >;
      open: FunctionReference<
        "mutation",
        "internal",
        {
          body: string;
          context?: Record<string, string>;
          requesterEmail: string;
          requesterId: string;
          requesterName: string;
          scope?: string;
          subject: string;
        },
        { number: number; ticketId: string },
        Name
      >;
      removeByRequester: FunctionReference<
        "mutation",
        "internal",
        { batch?: number; requesterId: string },
        number,
        Name
      >;
      removeByScope: FunctionReference<
        "mutation",
        "internal",
        { batch?: number; scope: string },
        number,
        Name
      >;
      reply: FunctionReference<
        "mutation",
        "internal",
        {
          authorId: string;
          authorName: string;
          body: string;
          from: "customer" | "staff";
          private?: boolean;
          ticketId: string;
        },
        { messageId: string; reopened: boolean },
        Name
      >;
      setStatus: FunctionReference<
        "mutation",
        "internal",
        {
          by: "customer" | "staff";
          status: "open" | "closed";
          ticketId: string;
        },
        boolean,
        Name
      >;
      staffCounts: FunctionReference<
        "query",
        "internal",
        {},
        { open: number; unread: number },
        Name
      >;
    };
  };
