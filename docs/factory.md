# Sending Support Requests To The Factory

A platform admin (an address in `OPERATOR_EMAILS`) can send a support request to a coding Factory, which files it as a bead, fixes it in a pull request and reports back. The request then shows **Fixed** in Support and on the customer's Get Help page.

## How A Request Gets There

1. A team owner or team admin files it from **Get Help**, often with **Report a problem**. Team members can't file. It keeps the category, the page they came from, the team, their description, and the id and step log of the team's latest failed run.
2. The platform admin opens it in **Platform Admin → Support**, writes or checks the **Summary for the Factory** and presses **Send to Factory**. The repository is public, so the summary is what a pull request may show: it is refused when it holds an email address, a link, or the customer's or team's name.
3. The Factory reads the sent requests from the endpoints below and calls back when one is fixed.

## Setting It Up

Make a long random token (`openssl rand -hex 32`), set it on the Convex deployment, and give the same value to the Factory:

```bash
npx convex env set FACTORY_INTAKE_TOKEN <token>
```

Without it every call below answers `403`.

## The Endpoints

All three are on the Convex HTTP address (`https://<your-convex-site>`). Each call sends the token as `Authorization: Bearer <token>`; a wrong or missing token answers `403`.

### `GET /factory/tickets[?cursor=<c>]`

The requests a platform admin sent that are not fixed yet, oldest first, 50 a page.

```json
{
  "tickets": [
    {
      "id": "kh7…",
      "title": "Clips step fails on long videos",
      "category": "automations",
      "page": "/runs",
      "team": "<team id>",
      "description": "What the customer wrote, with names and email addresses replaced by [name] and [email].",
      "stepLog": "Weekly Clips: failed: …\n- Cut clips: failed: …",
      "url": "https://<your-site>/admin/support?ticket=kh7…",
      "updatedAt": "2026-11-28T12:00:00.000Z"
    }
  ],
  "nextCursor": "1795850143000.5"
}
```

- `id` uses only `A-Z a-z 0-9 _ . : -`.
- `title` is the summary the platform admin checked, at most 200 characters.
- `team` is the team's id, never its name.
- `updatedAt` changes when the summary changes.
- Pass `nextCursor` back as `cursor` for the next page; it is `null` on the last one.

### `GET /factory/tickets/<id>`

One sent request, in the same shape. `404` when it was never sent, is already fixed, or doesn't exist.

### `POST /factory/tickets/<id>/fixed`

```bash
curl -X POST "https://<your-convex-site>/factory/tickets/<id>/fixed" \
  -H "Authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"beadId": "dash-abc", "reason": "Clip timing fixed in the caption step", "closedAt": "2026-11-28T12:00:00Z"}'
```

`beadId` and `reason` are required; `closedAt` is optional. The answer is `200` with `{"ok": true, "repeat": false}`, and the request shows Fixed. Saying it again answers `200` with `"repeat": true` and changes nothing. An id that was never sent answers `404`, and a body without `beadId` or with a `closedAt` that is not a date answers `400`.
