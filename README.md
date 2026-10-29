# HEY WALL

A local greeting wall. Log in, give the poster agent a note and a few snippets, watch the greeting stream onto a poster, then approve it. Approval is what publishes it. The agent picks a category and a group, and anyone logged in can open the other boards.

## Run

```bash
cd demo-wall
npm ci
npm run dev
```

Open http://127.0.0.1:4000

The wall listens on port 4000. The poster agent listens on port 4001. `npm run dev` builds first, then starts both. Logs are JSON on stdout.

Copy `.env.example` to `.env` only if you want different ports, a shared `INTERNAL_TOKEN`, or an OTLP endpoint. The app runs with the defaults when `.env` is missing.

House posters from nova, rio, and mica are already on the wall. Those names are taken. Sign up with another name. Snippets can show up on the poster. The rest of the note stays with you.

Check the messaging API directly:

```bash
curl -N -X POST http://127.0.0.1:4001/v1/messages \
  -H 'content-type: application/json' \
  -d '{"userId":"usr_demo","sessionId":"ses_demo","draftId":"drf_demo","notes":"made it through a quiet week","snippets":["still here"]}'
```

`GET /health` on each process returns `{ "ok": true, "service": "..." }`.

## Docker

```bash
docker compose up --build
```

## Checks

```bash
npm run check
```

## This slice

Poster copy is composed on this machine from the note and snippets, then streamed word by word. Nothing is published until the author approves it. The agent then categorizes the approved poster onto a group board.

Not in this slice: a model provider, email or password reset, more than one SQLite file, an open-ended category list, and a bundled collector. Set `OTEL_EXPORTER_OTLP_ENDPOINT` yourself if you want OTLP export. `STREAM_DELAY_MS` is capped at 80.
