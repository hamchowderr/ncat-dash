# Starting An Automation From Another App

An automation whose trigger is **Webhook** starts a run each time another app (n8n, a script, a form) sends a POST to its address. Copy the address from the trigger panel in the automation's editor. The automation has to be switched on.

## Sending A Call

```bash
curl -X POST "https://<your-convex-site>/automations/hook?id=<automation id>" \
  -H "X-Takewon-Token: <token>" \
  -H "Idempotency-Key: episode-4" \
  -H "content-type: application/json" \
  -d '{"file_url": "https://files.example/interview.mp4", "callback_url": "https://n8n.example/webhook/done"}'
```

- **The token** goes in an `X-Takewon-Token` header, as `Authorization: Bearer <token>`, or in the address as `&token=`. A header keeps it out of server logs.
- **`file_url`** (or `url`) is the file the run works on. **`files`** hands over several links at once, up to 100.
- **Everything else** in the body is kept with the run, and its steps can use it.
- **`Idempotency-Key`** is optional. Send the same key again within a day and no second run starts: the answer is the first run, with `"repeat": true`.
- **`callback_url`** is optional. When the run ends, its report is posted there.

## The Answer

A new run answers `202` with:

```json
{ "run_id": "…", "status_url": "https://<your-convex-site>/automations/hook/run?id=…&run=…" }
```

A call it cannot use answers `422` with what is wrong, a wrong token `403`, and a switched-off automation `409`.

## How The Run Went

A GET to `status_url`, with the token the same ways as above, answers:

```json
{
  "run_id": "…",
  "automation_id": "…",
  "automation": "From n8n",
  "status": "done",
  "error": null,
  "files": ["https://…/clip-1.mp4"],
  "started_at": 1763795000000,
  "finished_at": 1763795090000
}
```

`status` is `running`, `waiting`, `done`, `failed` or `cancelled`. `files` holds the finished files once it is done.

## The Callback

When the run ends, the same report is posted to `callback_url` as JSON. It carries an `X-Takewon-Signature: sha256=<hex>` header: the HMAC-SHA256 of the body, keyed with the automation's token. Check it before you trust the post. If the address does not answer with a 2xx, it is tried again after 30 seconds, 2 minutes and 10 minutes, then left.
