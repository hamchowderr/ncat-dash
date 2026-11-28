# convex-support-tickets

In-app support tickets for [Convex](https://convex.dev) apps: a customer asks a question
from inside your app, your support people answer it, and both sides see the conversation
live. Built for [Takewon](https://takewon.com), its first user.

- Tickets with a short number (`#42`), a subject, and open or closed.
- Messages from the customer and from support, oldest first.
- Private notes that only support sees, never returned to the customer's side.
- Unread on both sides: a customer sees "new answer", support sees what it hasn't read.
- Context kept with each ticket (the page they were on, their browser, a job id: any
  string pairs you choose).
- A customer writing on a closed ticket opens it again.
- Removal by person or by scope (a team, a workspace), for account and team deletion.
- Handing a ticket to an outside fixer, such as a coding agent's queue, with a short
  summary staff wrote that is safe to show in public.

The component knows nothing about who is signed in, because Convex components can't see
`ctx.auth`. Your app decides who may do what, and passes plain ids and names in. It sends
no email either: send yours from the app (Takewon uses toSend) after a reply.

## Install

```sh
npm install convex-support-tickets
```

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import supportTickets from "convex-support-tickets/convex.config.js";

const app = defineApp();
app.use(supportTickets);
export default app;
```

## Use

```ts
// convex/support.ts
import { SupportTickets } from "convex-support-tickets";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const support = new SupportTickets(components.supportTickets);

export const open = mutation({
  args: { subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx); // your own sign-in check
    return await support.open(ctx, {
      requester: { id: me.id, name: me.name, email: me.email },
      subject: args.subject,
      body: args.body,
      context: { page: "/billing" },
    });
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return await support.listForRequester(ctx, me.id);
  },
});

export const conversation = query({
  args: { ticketId: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const found = await support.get(ctx, args.ticketId);
    // A customer only ever reaches their own tickets, and never private notes.
    return found?.ticket.requesterId === me.id ? found : null;
  },
});

export const answer = mutation({
  args: { ticketId: v.string(), body: v.string(), private: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const staff = await requireSupportStaff(ctx); // your own check
    await support.reply(ctx, {
      ticketId: args.ticketId,
      from: "staff",
      author: { id: staff.id, name: staff.name },
      body: args.body,
      private: args.private,
    });
  },
});
```

The full API: `open`, `reply`, `close`, `reopen`, `markRead`, `get` (with
`{ withPrivate: true }` for staff), `byNumber`, `listForRequester`, `listByStatus`,
`staffCounts`, `customerUnread`, `handOff`, `removeForRequester` and `removeForScope`.

## Testing with convex-test

```ts
import supportTickets from "convex-support-tickets/test";

const t = convexTest(schema, modules);
supportTickets.register(t, "supportTickets");
```

## Status

Not on npm yet. It lives in the Takewon repository and ships its TypeScript source; a
build to `dist/` comes with the first npm release.
