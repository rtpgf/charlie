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

`/alexa` handles `LaunchRequest`, acknowledges `SessionEndedRequest`, and answers
anything else with a graceful "Sorry, I can't do that yet."

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
src/
  index.ts              process entrypoint
  server.ts             Express app + routes
  config.ts             environment configuration
  logger.ts             structured logging
  alexa/
    handler.ts          request envelope -> service
    responses.ts        Alexa response envelope builders
    verify.ts           signature / timestamp / skill-id verification
  services/
    greeting.ts         the words Charlie says
tests/
```

Alexa-protocol concerns stay in `src/alexa/`; the words Charlie speaks come from
`src/services/`. Later intents add a case in `handler.ts` and a service function.
