# Weekend Charlie — Milestone 1

The smallest working backend that can serve as the HTTPS endpoint for an Alexa
Custom Skill named **Charlie**.

Goal of this milestone: say "Alexa, open Charlie" to a physical Echo and hear
words authored by this server.

> Alexa: "Hi. I'm Charlie. Weekend Charlie is alive."

Nothing else is implemented. No AI, no SMS, no database, no photos.
See [CHARLIE.md](CHARLIE.md) for the product direction.

## Requirements

- Node.js **20 or newer** (`node -v`). This repo's `nvm` version is `v20.20.2`;
  if your default `node` is older, run `nvm use 20` first.

## Setup

```bash
nvm use 20
npm install
cp .env.example .env
```

Then set `DATABASE_URL` in `.env` and create the schema — see
[Database](#database) below.

## Database

Charlie stores its family knowledge in Postgres. Any Postgres works; Supabase
is the path of least resistance because it needs nothing installed locally.

**Supabase**: create a project, then click **Connect** at the top of the
dashboard to get the connection strings.

Choose the **Session pooler** (port 5432, host `*.pooler.supabase.com`). The
*Direct connection* is IPv6-only, so it times out with `connect ETIMEDOUT` on an
IPv4-only network — the failure looks like a credentials problem but is not.
Avoid the *Transaction pooler* (port 6543); it disallows things a long-lived
server relies on.

Note the session pooler changes the username to `postgres.PROJECTREF`, not plain
`postgres` — copy the whole string rather than editing a direct-connection one.

The database password is separate from your dashboard login. Reset it under
**Database → Settings → Database password** if you did not capture it at project
creation. Keep it alphanumeric, or percent-encode it: it sits inside a URL, so
`@ : / ? # &` will corrupt the connection string.

An occasional `password authentication failed` on first connect is the pooler
warming up. Retry once before changing anything.

Create the schema and load the development household:

```bash
npm run db:migrate     # applies migrations/*.sql, tracked in schema_migrations
npm run db:seed        # rebuilds the "Weekend Charlie" household
```

`db:seed` is idempotent — re-run it freely; it replaces the household rather
than duplicating it.

### Schema

| Table          | Holds                                                          |
| -------------- | -------------------------------------------------------------- |
| `household`    | One family unit                                                 |
| `alexa_user`   | Maps an Alexa `userId` to a household                           |
| `person`       | Full name, preferred name, optional gender                      |
| `person_alias` | Extra names a person answers to (`JT`, `James`, `James Thomas`) |
| `relationship` | **Asserted** relationships only, with provenance                |

Only asserted relationships are stored (`parent_of`, `sibling_of`). Aunt, uncle,
niece, and nephew are derived at query time in [graph.ts](src/family/graph.ts)
and never written to the database — persisting a derivation would later make it
impossible to tell what a family member actually said from what Charlie worked
out. Every relationship row carries `source_type` and `confidence`; seeded rows
are `seed` / `confirmed`.

`gender` is optional and only ever set from an explicit statement. It is never
inferred from a name. When it is absent, descriptions fall back to neutral terms
(`child`, `sibling`, `niece or nephew`).

### Seeded household

```text
Jenna ──sibling_of── Hannah
                       ├── parent_of ── Natalie Rose ("Natalie")
                       └── parent_of ── James Thomas ("JT", aliases: JT, James, James Thomas)
```

## Alexa user mapping

A skill request carries an Alexa `userId`. Charlie answers family questions only
for a `userId` mapped to a household. Mapping is manual for Weekend Charlie —
account linking and OAuth are out of scope.

To find your `userId`, ask Charlie a family question from your Echo before any
mapping exists. The request is rejected gracefully and the id is written to the
server log:

```json
{"level":"warn","msg":"no household mapped for alexa user","alexaUserId":"amzn1.ask.account.AF..."}
```

Copy that value into `.env`, then re-seed:

```bash
DEV_ALEXA_USER_ID=amzn1.ask.account.AF...   # in .env
npm run db:seed
```

The id lives only in `.env` and the database, never in source.

## Run

```bash
npm run dev          # watch mode on http://localhost:3000
npm run build        # compile TypeScript to dist/
npm start            # run the compiled server
```

## Verify

```bash
npm test             # test suite
npm run typecheck    # TypeScript, no emit
```

The tests need no database server and no cloud account. Database-backed tests
run against [PGlite](https://github.com/electric-sql/pglite) — real PostgreSQL
compiled to WASM, in-process — so the SQL under test is the same SQL that runs
against Supabase. Each test gets a freshly migrated database.

## Local manual check

Signature verification rejects handcrafted requests by design, so disable it for
local curl testing only:

```bash
ALEXA_VERIFY_REQUESTS=false npm run dev
```

```bash
curl -s localhost:3000/health

curl -s -X POST localhost:3000/alexa \
  -H 'Content-Type: application/json' \
  -d '{"version":"1.0","request":{"type":"LaunchRequest","requestId":"r1","locale":"en-US"}}'
```

Expected response:

```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": { "type": "SSML", "ssml": "<speak>Hi. I'm Charlie. Weekend Charlie is alive.</speak>" },
    "card": { "type": "Simple", "title": "Charlie", "content": "Hi. I'm Charlie. Weekend Charlie is alive." },
    "shouldEndSession": true
  }
}
```

**Leave `ALEXA_VERIFY_REQUESTS=true` for anything Amazon can reach**, including a
tunnel to your laptop.

## Exposing the endpoint over HTTPS

Alexa requires port **443** with a certificate trusted by Amazon. The Node server
speaks plain HTTP; TLS is terminated in front of it.

The test rig is `charlie.servehttp.com` (No-IP dynamic DNS) with Caddy on 443.

1. Router: forward external **443 → 192.168.68.110:8443** (TCP). That is this
   machine's *Ethernet* address, so it must stay wired; give the Ethernet MAC a
   DHCP reservation so the forward survives a lease change.

   Port 80 is not forwarded. Caddy uses the ACME TLS-ALPN-01 challenge, which
   arrives on external 443, so issuance and renewal work without it.

2. Run the app and the front door in two terminals:

   ```bash
   npm run dev                        # Node on 3000
   caddy run --config ./Caddyfile     # TLS on 8443, proxies to 3000
   ```

3. Confirm from outside the LAN — a phone on cellular, not the local network,
   since many routers do not support NAT hairpin:

   ```bash
   curl -s https://charlie.servehttp.com/health
   ```

Caddy obtains and renews the certificate automatically. Nothing else is needed.

## Alexa Developer Console setup

Done once, manually, at [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask).
Sign in with **the same Amazon account the Echo is registered to** — a skill in
Development mode is only available to that account's devices.

1. **Create Skill** → name `Charlie`, locale English (US), model **Custom**,
   hosting **Provision your own**, template **Start from Scratch**.
2. **Build → Invocation → Skill Invocation Name**: `weekend charlie`.
   Amazon requires two or more words unless the name is a recognized brand, so
   `charlie` alone is rejected. Splitting one word to satisfy the rule
   (`char lee`) builds but misbehaves at runtime — don't.
3. **Build → Endpoint → HTTPS**:
   - Default Region: `https://charlie.servehttp.com/alexa`
     — the `/alexa` path is required; the bare domain returns 404 and Alexa
     reports "interruption in service" with nothing in our logs.
   - Certificate: **"My development endpoint has a certificate from a trusted
     certificate authority"** (Caddy provides a real Let's Encrypt certificate).
   - Click **Save Endpoints**. The endpoint saves separately from the model — a
     model build does not persist it.
4. **Build Model** and wait for completion. Invocation name changes need a
   rebuild; endpoint changes do not.
5. Copy the **Skill ID** into `ALEXA_SKILL_ID` in `.env`, then **restart the
   server**. `tsx watch` watches `src/`, not `.env`, so editing it changes
   nothing until you restart. Confirm the startup log shows
   `"skillIdConfigured":true`.
6. **Test** tab → set the dropdown to **Development**.

Then say: **"Alexa, open weekend charlie."**

### Interaction model

The full model is [alexa/interaction-model.json](alexa/interaction-model.json).
To apply it: **Build → Interaction Model → JSON Editor**, paste the file,
**Save Model**, then **Build Model**.

It adds one intent. `personName` is a slot, so there is no per-person intent:

```text
WhoIsPersonIntent   who is {personName}
                    who's {personName}
                    who {personName} is          <- "Alexa, ask Charlie who Natalie is"
                    tell me about {personName}
                    what do you know about {personName}
```

The slot type is the built-in `AMAZON.FirstName`, **extended** with values the
built-in would not otherwise recognize (`JT` with synonyms `J T` / `J.T.`,
`James Thomas`, `Natalie Rose`). Extending rather than replacing matters: a
custom slot type would bias recognition toward known names, and asking about
someone Charlie has never heard of ("who is Robert?") needs to still reach us so
it can be answered honestly.

If the console rejects the extension, delete the `types` block and rebuild —
the bare built-in works, with weaker recognition of `JT`.

Note that adding family members to the database does not require a model
rebuild. The values above are recognition hints, not the set of answerable
names.

### The console simulator cannot work here

The Test tab's Alexa Simulator sends requests **without** the
`SignatureCertChainUrl` and `Signature-256` headers, so signature verification
correctly rejects them with 400 and the simulator reports "The service is
temporarily unavailable." Our logs show
`verification failed ... Missing Certificate for the skill request`.

Real Echo devices sign their requests and work. **Test on hardware**, and do not
disable `ALEXA_VERIFY_REQUESTS` to make the simulator pass — the endpoint is
publicly reachable and that check is its only protection.

The simulator is still useful for one thing: confirming an invocation name
resolves and the request reaches our logs at all.

## Endpoints

| Method | Path      | Purpose                                     |
| ------ | --------- | ------------------------------------------- |
| `GET`  | `/health` | `{"status":"ok","service":"weekend-charlie"}` |
| `POST` | `/alexa`  | Alexa Custom Skill request envelope          |

`/alexa` handles `LaunchRequest`, answers family questions via
`WhoIsPersonIntent`, supports Help/Stop/Cancel, acknowledges
`SessionEndedRequest`, and answers anything else with "Sorry, I can't do that
yet."

Failures are spoken rather than surfaced as HTTP errors: an unreachable database
produces "I'm having trouble remembering right now" instead of Alexa's generic
"there was a problem with the requested skill's response." The underlying cause
is still logged at `error` level — the 200 is for the listener, not a claim that
nothing went wrong.

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable                | Default       | Purpose                                                     |
| ----------------------- | ------------- | ----------------------------------------------------------- |
| `PORT`                  | `3000`        | HTTP port                                                    |
| `HOST`                  | `0.0.0.0`     | Bind address                                                 |
| `NODE_ENV`              | `development` | Environment name                                             |
| `LOG_LEVEL`             | `info`        | `debug` \| `info` \| `warn` \| `error`                       |
| `ALEXA_VERIFY_REQUESTS` | `true`        | Alexa signature + timestamp verification                     |
| `ALEXA_SKILL_ID`        | _(unset)_     | When set, rejects requests from any other skill              |
| `DATABASE_URL`          | _(unset)_     | Postgres connection string (Supabase or any Postgres)        |
| `DEV_ALEXA_USER_ID`     | _(unset)_     | Alexa userId mapped to the seeded household by `db:seed`     |

## Alexa request verification

Amazon requires a self-hosted skill endpoint to verify every inbound request.
This is implemented with Amazon's own verifiers from `ask-sdk-express-adapter`
rather than hand-rolled crypto:

- `SkillRequestSignatureVerifier` — validates the `Signature-256` and
  `SignatureCertChainUrl` headers against the raw request body.
- `TimestampVerifier` — rejects requests whose timestamp is more than 150
  seconds from now.

Failures return `400`, as Amazon documents. The raw request bytes are captured
via `express.json({ verify })` because the signature covers the exact bytes sent.

Reference: [Host a Custom Skill as a Web Service](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html)

## Logging

Structured JSON lines. Request logs include request type, request ID, locale,
and intent name. They deliberately exclude the request body, `userId`,
`deviceId`, and `apiAccessToken`.

## Layout

```
migrations/
  001_family.sql        schema, applied in filename order
alexa/
  interaction-model.json  paste into the console's JSON editor
src/
  index.ts              process entrypoint
  server.ts             Express app + routes
  config.ts             environment configuration
  logger.ts             structured logging
  bin/
    db.ts               npm run db:migrate / db:seed
  alexa/
    handler.ts          request envelope -> service
    responses.ts        Alexa response envelope builders
    verify.ts           signature / timestamp / skill-id verification
  db/
    index.ts            connection pool + the Db interface
    migrate.ts          migration runner
    seed.ts             the development household
  family/
    graph.ts            family model + kinship rules (pure)
    describe.ts         kinship -> sentence (pure)
    repository.ts       all SQL for the family model
    service.ts          what the Alexa handler calls
  services/
    speech.ts           the words Charlie says
tests/
```

Alexa-protocol concerns stay in `src/alexa/`; the handler contains no SQL and
walks no relationships. It calls `src/family/service.ts`, which loads a
household through `repository.ts` and reasons about it with the pure functions
in `graph.ts` and `describe.ts`. A household is small, so it is loaded whole and
traversed in memory rather than through recursive SQL — and keeping the rules
pure means most family behaviour is testable with no database at all.

Later intents add a case in `handler.ts` and a service function.

## Future considerations

Noted while building, deliberately not built:

- **Sibling inference from shared parents.** Natalie and JT share a parent but no
  `sibling_of` was asserted, so Charlie does not call them siblings. Inferring it
  is reasonable but should be recorded as inferred, not asserted.
- **Wider kinship** — grandparents, cousins, in-laws, step- and half-relations.
  The current rules stop at aunt/uncle and niece/nephew.
- **Relationship metadata** such as birth order, so "younger sister" is possible.
- **Non-binary and unspecified gender terms** beyond the current neutral
  fallbacks.
- **Provenance beyond seeding**: `source_type` already distinguishes `seed`,
  `stated`, and `inferred`, but nothing yet writes the latter two.
