# App Spec: OAuth2 Provider Toolkit

> The App Spec is a business architecture document that sits above feature specs.
> It captures domain knowledge, validates cross-spec consistency, and ensures
> the app solves a real business problem using the platform correctly.
>
> This document is the SINGLE SOURCE OF TRUTH for what this capability is, who it serves,
> and how it maps to the platform. Feature specs are generated from this document.
> If a spec contradicts this document, this document wins.

**Status:** Draft — proposal, pending review. No implementation until confirmed.
**Scope:** OM acting as an **OAuth2 client** to obtain and maintain third-party **API access** tokens for Integration providers (Xero, QuickBooks, HubSpot, Google Workspace, Slack, …). Explicitly **not** user-login SSO (§ 6.5).
**Home (proposed):** `packages/core/src/modules/integrations/lib/oauth2/` + generic routes under `/api/integrations/oauth/[provider]/*`.
**Supersedes:** `.ai/specs/2026-09-26-oauth2-provider-toolkit-reuse.md` (the narrow "just narrow one type" proposal drafted on the `xero-integration` branch — retained there as the fallback Option A in § 6.1).

---

## 0. Research notes (provenance for every decision below)

### 0.1 OAuth 2.0 standards & current best practice — from trained knowledge (cutoff May 2026), NOT a live fetch

Live web access (`WebFetch`/`WebSearch`) was denied in this environment for the whole session. The standards below are stable, long-published RFCs and I am confident in them, but **§ 10 #1 carries a verification task** to diff this list against the current IETF OAuth WG state before implementation.

**The normative baseline:**

| Spec | What it gives us | Relevance here |
|---|---|---|
| RFC 6749 | OAuth 2.0 core; authorization-code + refresh-token grants | The only two grants this toolkit needs |
| RFC 6750 | Bearer token usage | How the access token is attached to provider API calls |
| **RFC 7636 (PKCE)** | `code_verifier`/`code_challenge` (`S256`) binding the authorization request to the token request | **Originally for public clients; RFC 9700 and OAuth 2.1 require it for ALL clients, including confidential ones with a client secret** — it defends against authorization-code injection, which a client secret does not |
| **RFC 9700 (OAuth 2.0 Security Best Current Practice)** | The consolidated modern security baseline (formerly `draft-ietf-oauth-security-topics`) | The checklist this toolkit should be measured against — see the six items below |
| **OAuth 2.1 (draft)** | Consolidation of 6749 + BCP: PKCE mandatory, implicit grant removed, ROPC removed, exact redirect-URI string matching, refresh tokens must be sender-constrained **or** rotated with reuse detection, no bearer tokens in query strings | The direction of travel; building to 2.1 now avoids a migration later |
| RFC 9207 | `iss` parameter in the authorization response — authorization-server issuer identification | **Mix-up attack defense. Directly relevant: a marketplace client talks to many ASes, which is exactly the precondition for mix-up attacks** |
| RFC 7009 | Token revocation endpoint | Disconnect should revoke at the provider, not just delete locally |
| RFC 8414 / OIDC Discovery | AS metadata at `.well-known/oauth-authorization-server` / `.well-known/openid-configuration` | Lets a provider descriptor be 3 lines instead of 30 when the provider publishes discovery (Xero does) |
| RFC 9449 (DPoP) / RFC 8705 (mTLS) | Sender-constrained tokens | Not needed now; matters if OM ever integrates a FAPI-grade financial API. Worth *not* precluding |
| RFC 9126 (PAR) / RFC 9396 (RAR) | Pushed authorization requests / rich authorization requests | Not needed now; same "don't preclude" note |
| RFC 8628 | Device authorization grant | Out of scope — OM always has a browser available |

**The six RFC 9700 items that actually bite an integration marketplace:**

1. **PKCE on every authorization-code flow**, confidential clients included.
2. **Exact redirect-URI matching** — no wildcards, no prefix/suffix matching, no open redirector reachable from the callback.
3. **CSRF protection on the callback** — `state` bound to the initiating session (PKCE covers code injection; `state` still carries app-level state and session binding).
4. **Issuer identification (`iss`) when the client serves multiple ASes** — otherwise an attacker-controlled AS can induce the client to send a code issued by AS-A to AS-B's token endpoint.
5. **Refresh-token protection** — either sender-constrained, or **rotated on every use with automatic reuse detection**: replaying a superseded refresh token means the family is compromised, so revoke the whole family rather than just failing the one call.
6. **No tokens in URLs, no tokens in logs; tokens encrypted at rest.**

**Concurrency is not in the RFCs, but it is the #1 production failure mode** for rotating-refresh-token providers (Google, Xero, Salesforce, Shopify Partner…): two concurrent workers both see a near-expiry token, both exchange the same refresh token, the second exchange invalidates the first, and the connection flaps to "needs reauthorization" with no user-visible cause. Every serious implementation solves this with mutual exclusion around refresh, plus tolerance for the losing racer (reload-and-retry rather than fail).

### 0.2 Professional prior art — how mature products solve exactly this

| Product / library | Approach | What to adopt | What to reject |
|---|---|---|---|
| **Nango** (open-source unified-integration platform) | A **declarative provider registry** (`providers.yaml`): per provider, the `auth_mode`, authorization/token URLs (templated with connection config), scope separator, extra authorize params, token-response field paths, and documented quirks. Hundreds of providers, one engine. Refresh locking in the database; `invalid_grant` → mark connection as needing reauth + emit a webhook | **The declarative-descriptor-over-per-provider-code model, and DB-level refresh locking** — this is the single most important structural idea in this spec | Its unified-API/proxy layer and hosted control plane — that is a product, not a util (§ 6.2 Option D) |
| **Auth.js / NextAuth** | Provider config objects (`authorization`, `token`, `userinfo` endpoints + `checks: ['pkce','state']`), ~80 built-in providers | Descriptor shape, and **`checks` as explicit, per-provider security opt-outs rather than implicit behavior** | Its session/login orientation — wrong use case (§ 6.5) |
| **arctic** (Lucia author) | Typed, minimal per-provider classes for 100+ providers, PKCE-first | Evidence that a small typed descriptor covers the long tail | Per-provider classes — a descriptor table is less code than 100 classes |
| **Passport.js strategies** | One npm package per provider (hundreds of near-identical packages) | — | **The cautionary tale**: what happens without a declarative core. OM is currently on this path (one hand-rolled `lib/oauth.ts` per provider package) |
| **`openid-client`** (panva, OpenID-certified) | The protocol engine: discovery, PKCE, `iss` checks, token endpoint auth methods, refresh, revocation, DPoP, PAR | **Delegate protocol mechanics to it instead of hand-rolling** — and OM *already depends on it* (§ 0.3, finding 6) | Nothing material; its OIDC-centrism is a documented, workable constraint for non-OIDC providers (manual server metadata instead of discovery) |
| **Airbyte / Meltano** | Declarative connector specs with an `OAuthAuthenticator` (token refresh request body, expiry field paths) | Confirms the descriptor-with-field-paths pattern generalizes to messy real providers | Their connector-container model — irrelevant here |
| **Keycloak / Hydra / Auth0** | Authorization *servers* | Terminology only | Not our role — OM is the client |

**Synthesis — what "professional" means for this specific problem:** one protocol engine (not hand-rolled, not one-per-provider), a declarative per-provider descriptor for the quirks, PKCE + `state` + `iss` on by default with per-provider opt-out only where a provider is non-compliant, encrypted token storage, refresh under a **cross-process** lock with rotation-reuse tolerance, revocation on disconnect, and an explicit machine-readable "this connection needs reauthorization" state surfaced to an operator.

### 0.3 Open Mercato's current state — read directly from the repository (authoritative)

1. **`channel-gmail` implements OAuth2 by hand, with no PKCE.** `packages/channel-gmail/src/modules/channel_gmail/lib/oauth.ts:64-76` builds the authorize URL with `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `access_type=offline`, `prompt=consent`, `include_granted_scopes` — **no `code_challenge`**. `:78-88` exchanges the code with `client_secret` in the request body (`client_secret_post`) and **no `code_verifier`**. This is a compliant-but-dated RFC 6749 confidential-client flow that fails RFC 9700 item 1.
2. **PKCE is notionally accommodated but used by nobody.** `communication_channels/lib/oauth-state.ts:200-204` documents "PKCE verifiers are NOT generated here — the provider adapter decides whether it needs PKCE and packs the verifier into `extra`". No provider does.
3. **Refresh coalescing is in-process only.** `communication_channels/lib/credential-refresh.ts:60` holds `const inFlightRefreshes = new Map<string, Promise<...>>()` — a module-global, per-process map. Its own comment scopes the guarantee honestly: *"prevents that race for the common single-process case."* OM runs web and queue-worker processes separately (and can run replicas), so the cross-process race is unmitigated today.
4. **`credential-refresh.ts` is typed against `ChannelAdapter`** (`:31`), a broad chat/email/SMS provider interface, so no non-channel integration can reuse it without implementing an irrelevant contract.
5. **`oauth-state.ts` and `oauth-token.ts` are already provider-agnostic and already imported across a package boundary** by `channel-gmail` (`lib/oauth.ts:12-16`) — they are the one piece of genuine existing reuse, and this spec keeps them (relocated, § 6.3).
6. **`packages/enterprise` already depends on `openid-client` ^6.8.4, and the SSO module uses it properly — including PKCE.** `packages/enterprise/src/modules/sso/lib/oidc-provider.ts` calls `client.calculatePKCECodeChallenge` (`:36`), `client.buildAuthorizationUrl` (`:39`), `client.authorizationCodeGrant` (`:70`), `client.discovery` (`:147`), and wires a guarded fetch (`[client.customFetch]: this.guardedFetch`, `:153`) with an SSRF-safety helper in `lib/oidc-url-safety.ts`. There is also a Jest mocking precedent at `lib/__tests__/oidc-provider.test.ts:1`.
   **This is the decisive finding of this research.** The professional approach is already in this repository, already version-pinned, already test-mocked — but it lives in the **commercial** package, for the **login** use case, and core's OSS integration flow independently reinvented a weaker version of the same thing. Core cannot import enterprise (root `AGENTS.md`), but nothing stops core from depending on the same public npm package.
7. **A third copy of the state-cookie pattern exists.** `communication_channels/lib/oauth-state.ts:6-7` states outright that it is a re-implementation of `packages/enterprise/src/modules/sso/lib/state-cookie.ts`, forced by the core→enterprise import ban. So the repo already carries **two** state-cookie implementations; Xero and Google Workspace would make it three and four.
8. **The `oauth` credential-field type is dead declarative surface.** `packages/shared/src/modules/integrations/types.ts:95-102` declares `IntegrationCredentialFieldOauth` with `authUrl`/`tokenUrl`/`scopes`/`clientIdField`/`clientSecretField`, and `packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx:67` refuses to render it (`UNSUPPORTED_CREDENTIAL_FIELD_TYPES = new Set(['oauth', 'ssh_keypair'])`). Every provider therefore hand-builds its own "Connect" widget.
9. **Storage, state and health infrastructure is already good and is reused as-is:** `IntegrationCredentials` with per-tenant envelope encryption (AES-256-GCM, KMS-managed DEK, fails closed), optional `scope.userId` for per-user vs tenant-wide credentials, `IntegrationState.reauthRequired` as a first-class column, `integrationHealthService` with a 15-minute probe, and `IntegrationLog` with secret stripping.

**Findings 10-15 come from the dedicated repo audit dispatched for this spec (see § Changelog); several correct assumptions this document was originally drafted on.**

10. **There is a third OAuth2 client flow, using a grant OAuth 2.1 removes.** `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts:322-413` performs `grant_type=password` (Resource Owner Password Credentials) plus `grant_type=refresh_token`, holding token state in a module-closure variable (`:323`) with no persistence, no routes, no redirect. ROPC is removed in OAuth 2.1 and discouraged by RFC 9700. This is **out of scope** for this toolkit (§ 1.2) but it changes the count: OM has **three** client-side OAuth implementations today, not two, and each is a different shape.
11. **Cross-process refresh is confirmed reachable, and the current exposure is latent rather than active.** The audit traced `refreshCredentialsIfNeeded` callers in both web-request paths (`api/post/channels/[id]/test-send/route.ts:217`) and worker paths (`workers/poll-channel.ts:161`, `workers/gmail-history-sync.ts:119`, `workers/channel-import-history.ts:145`, `workers/reaction-processor.ts:182`, `push_notifications/lib/push-delivery.ts:382`), and confirmed OM runs workers as separate processes — `packages/cli/src/mercato.ts:2354,2566` spawns `queue worker --all` as a child process, `OM_AUTO_SPAWN_WORKERS_LAZY_MODE=per-queue` spawns **one process per queue** (`:2323-2324`), and `packages/create-app/template/scripts/railway-worker.sh` runs the worker as its own Railway service. So two processes can refresh one Connection concurrently, with nothing serializing them — no DB lock, no row-version check, no `SELECT … FOR UPDATE`. **Important nuance for honest ROI claims: Google does not rotate refresh tokens, so Gmail is not flapping today.** The exposure is latent for the current provider set and becomes *active* the moment a rotating-refresh provider lands — which is exactly what Xero is (§ 0.1, and the Xero App Spec's own § 0.1).
12. **Advisory locks are already used six times over, but there is no shared helper.** Raw inlined SQL at `attachments/lib/quota-service.ts:146` (`pg_advisory_xact_lock(hashtextextended(...))`), `notifications/lib/notificationService.ts:199`, `query_index/lib/coverage.ts:154`, `packages/documents/.../lib/folderHierarchySerialization.ts:3`, and `enterprise/.../record_locks/lib/recordLockService.ts:1558,1834`. There is **no** `withAdvisoryLock()` abstraction anywhere. `packages/cache` has no lock primitive at all (no `NX`/lease API). `record_locks` is a user-facing pessimistic UI lock, enterprise-only, and unusable from core. **Correction to this document's first draft:** `data_sync` does *not* use an advisory lock — the word "advisory" in its `lib/adapter.ts:54,84` is plain English ("This is not advisory"). So § 6.6's mechanism is the right one and has ample in-repo precedent, but the toolkit must write the missing helper (and six existing call sites would benefit from it).
13. **Disconnect is worse than "no revocation": the tokens survive, still valid.** `disconnect-channel.ts:135-141` sets `status='disconnected'`, `isActive=false`, `isPrimary=false`, `credentialsRef=null`, `lastError='user-disconnected'`. It nulls the *pointer* — the `integration_credentials` row is **not** deleted, so the encrypted refresh token remains at rest and remains valid at Google. Repo-wide, no revocation endpoint is ever called (grep for `revoke` finds only ACL/participant revocation and comments about tokens *being* revoked elsewhere). So WF5 must fix two things, not one: revoke remotely, **and** actually clear the stored Token Set.
14. **No mock authorization server exists, and no test exercises a real protocol round-trip.** Unit tests cover the state-cookie envelope (`oauth-state.test.ts`, including a `codeVerifier` round-trip that tests only the envelope, not PKCE itself), the token POST helper, and credential refresh; `channel-gmail`'s `oauth.test.ts` asserts authorize-URL params via a client seam; and SSO's `oidc-provider.test.ts:1-4` `jest.mock`s `openid-client` wholesale. There is no `nock`/`msw`/HTTP double in the Jest setup. US-0.1 therefore introduces genuinely new test infrastructure rather than extending existing fixtures.
15. **Redirect URIs are built from configured app base URL with a request-origin fallback**, via `toAbsoluteUrl(req, path)` → `getAppBaseUrl` = `NEXT_PUBLIC_APP_URL || APP_URL || resolveRequestOrigin(req)` (`packages/shared/src/lib/url.ts:248`), used at `initiate/route.ts:52-57` and `callback/route.ts:167` (whose own comment notes the two must match byte-for-byte behind a proxy). Two consequences: the helper is reusable as-is, and **the request-origin fallback is a live hazard** — with neither env var set, a proxy or Host-header difference changes the computed `redirect_uri` and breaks the exact-match requirement (RFC 9700 item 2). Also concrete evidence for § 10 #6: Gmail's own credential `helpText` instructs admins to register `<yourdomain>/api/communication_channels/oauth/gmail/callback` in Google Cloud Console, so that path is baked into tenant configuration outside OM's control.

**Net:** OM has excellent *storage and lifecycle* infrastructure for OAuth connections and three *separate, weak, non-PKCE protocol implementations* (redirect-based hub, hand-rolled Gmail client, Akeneo ROPC) — while simultaneously owning a correct, certified protocol layer one package away, and while disconnect leaves valid refresh tokens at rest.

---

## 1. Business Context `PM`

### 1.1 Business Model

Open Mercato's integration marketplace is a product surface: the more third-party systems a tenant can connect, the more of their operation lives in OM. The paying customer is the OM tenant; what they buy here is *time-to-connected* and *staying connected*. What OM (the vendor/maintainers) buys is **marginal cost per new integration** — today every OAuth2 provider re-pays the same protocol tax, and each re-payment is an independent opportunity to get PKCE, CSRF binding, or refresh concurrency subtly wrong.

**Flywheel:**
```
One vetted OAuth2 toolkit
  -> each new OAuth2 integration costs ~2 commits of provider descriptor instead of ~5 of protocol plumbing
  -> more providers shipped per quarter, at a uniform security baseline
  -> marketplace breadth becomes a reason tenants pick OM
  -> more tenants -> more provider requests -> more providers built on the same toolkit
  -> security/protocol fixes (PKCE, iss, DPoP) land once and benefit every provider retroactively
```

### 1.2 Business Goals

**Primary goal:** make "add an OAuth2 provider" a declarative, low-risk task, and make every OAuth2 connection in OM meet the RFC 9700 baseline. Measurable:
- A new OAuth2 provider integration needs **no hand-written protocol code** — a descriptor plus (optionally) one post-consent hook. Target: the OAuth portion of a new provider drops from ~5 atomic commits (the Xero App Spec's WF1 estimate) to ≤2.
- **100% of OM OAuth2 client flows use PKCE and session-bound `state`** after Phase 2, versus 0% using PKCE today (§ 0.3 findings 1-2).
- **Zero cross-process refresh races**: concurrent refresh of one connection is serialized regardless of process count, versus single-process-only today (§ 0.3 finding 3).

**Secondary goal:** stop the duplication trend before it compounds — collapse 2 existing state-cookie implementations (and 2 protocol layers) toward 1, instead of arriving at 4-5 as Xero and Google Workspace land.

**What is NOT important (explicit exclusions):**
- **User-login SSO** (OM as a relying party authenticating *people*) — that is `enterprise/sso`'s job, a different lifecycle and a different persona. § 6.5 treats the boundary as a first-class decision, not an oversight.
- OAuth2 **provider/server** role — OM issuing tokens to third parties. Entirely different capability (`api_keys` covers today's needs).
- Non-OAuth auth modes (API key, Basic, mTLS-only) — already handled by ordinary credential fields.
- Device grant, ROPC, implicit — excluded by design (§ 0.1). **Note this has a live consequence:** `sync-akeneo` uses ROPC today (§ 0.3 #10). This toolkit deliberately does not give it a home, because adding a grant OAuth 2.1 removes would undercut the whole point. Whether Akeneo migrates to authorization-code, keeps its own ROPC client, or is left alone is tracked as § 10 #8 rather than silently absorbed here.
- A hosted/unified-API proxy layer à la Nango's — product, not util (§ 6.2 Option D).
- Migrating `enterprise/sso` onto this toolkit — different use case; only the *shared state-cookie primitive* is in scope for de-duplication, and even that is Phase 4, optional (§ 6.5).

### 1.3 Ubiquitous Language

| Term | Definition | Source of data | Period |
|---|---|---|---|
| Authorization Server (AS) | The third party's OAuth2 endpoint set (authorize, token, optional revocation/discovery). One per Provider. | Provider descriptor / discovery document | N/A |
| Provider | A third-party system OM integrates with (`xero`, `gmail`, `hubspot`). Identified by the existing `providerKey` on `IntegrationDefinition`. **Not** a new identifier — reuses the registry's. | `integrations` registry | N/A |
| Provider Descriptor | The declarative record describing one Provider's OAuth2 surface and quirks (§ 1.4). Build-time data, authored by an integration developer, not tenant-editable. | Provider package source | N/A |
| Connection | One tenant's (optionally one user's) authorized link to one Provider — concretely, one `IntegrationCredentials` row holding a Token Set, plus its `IntegrationState`. **Deliberately not called "account" or "channel"**: `communication_channels` already uses `channelId` for its own per-mailbox concept, and a Connection is the broader notion. | `IntegrationCredentials` + `IntegrationState` | N/A |
| Token Set | The credential payload of a Connection: access token, refresh token, expiry, granted scopes, and optionally the selected Resource (§ 1.4). | Token endpoint response | N/A |
| Resource Selection | The post-consent step some Providers require to pick *which* remote entity the tokens act on — Xero's Organisation (`/connections` + `Xero-tenant-id`), Slack's workspace, HubSpot's portal. A first-class descriptor hook because it recurs. | Provider API, post-consent | N/A |
| Reauthorization (reauth) | The state where a Connection's refresh token is permanently unusable (expired, revoked, password-changed) and only a fresh user-driven consent can restore it. Surfaced via the existing `IntegrationState.reauthRequired`. | Refresh failure / health probe | N/A |
| Refresh | Exchanging a refresh token for a new access token. **Rotating** when the AS also returns a new refresh token and invalidates the old one (Google, Xero). | Token endpoint | N/A |
| Refresh Lock | The cross-process mutual exclusion held while one Connection is refreshed, so a rotating refresh token is never exchanged twice concurrently. | This toolkit | Per refresh |
| Integration Developer | The engineer adding a Provider. A **build-time consumer of this toolkit's API**, not an authenticated runtime persona — see § 2. | N/A | N/A |

### 1.4 Domain Model

The toolkit introduces **no new database entity**. It introduces two precisely-shaped in-code/in-JSON structures plus a lock.

**`OAuth2ProviderDescriptor`** — build-time, authored per provider package, registered into the existing integration registry:

| Field | Type | Multi | Required | Notes |
|---|---|---|---|---|
| `providerKey` | text | no | yes | Reuses `IntegrationDefinition.providerKey`; the registry key |
| `issuer` | text (URL) | no | no | When set and the AS publishes discovery, endpoints are discovered rather than declared |
| `authorizationUrl` | text (URL) | no | conditional | Required when `issuer` is absent |
| `tokenUrl` | text (URL) | no | conditional | Required when `issuer` is absent |
| `revocationUrl` | text (URL) | no | no | Enables RFC 7009 revoke-on-disconnect; absent = local-clear only |
| `scopes` | text | yes | yes | Default scope set requested at consent |
| `scopeSeparator` | select (`space` \| `comma`) | no | no | Default `space`; a real provider quirk |
| `clientAuthMethod` | select (`client_secret_basic` \| `client_secret_post` \| `none`) | no | no | Default `client_secret_basic`; Gmail today effectively uses `_post` (§ 0.3 #1) |
| `usePkce` | boolean | no | no | **Default `true`**; `false` requires a recorded justification (§ 6.4) |
| `checkIssuerParam` | boolean | no | no | RFC 9207; default `true` when the AS is known to send `iss`, else `false` |
| `extraAuthorizeParams` | json (`Record<string,string>`) | no | no | Google's `access_type=offline&prompt=consent`, etc. |
| `accessType` | select (`offline` \| `online`) | no | no | Convenience for the commonest of the above |
| `refreshTokenRotates` | boolean | no | no | Declares the provider rotates refresh tokens — drives lock strictness and reuse tolerance |
| `refreshSkewSeconds` | integer | no | no | Refresh when expiry is within this window; default 60 |
| `resourceSelection` | json hook descriptor | no | no | Declares that a post-consent Resource Selection step exists, and which service resolves it (§ 1.4 hook contract) |
| `credentialFieldKeys` | json (`{ clientId, clientSecret }`) | no | no | Which credential-field keys hold the app credentials; defaults `clientId`/`clientSecret` |

**`TokenSet`** — the shape stored inside the existing encrypted `IntegrationCredentials.credentials` JSON (additive to whatever else a provider stores; no schema change):

| Field | Type | Required | Notes |
|---|---|---|---|
| `accessToken` | text | yes | Encrypted at rest by the existing envelope |
| `refreshToken` | text | no | Absent for providers that don't issue one |
| `expiresAt` | datetime (ISO) | no | Absent when the AS omits `expires_in`; then refresh is `force`-only |
| `grantedScopes` | text[] | no | What the user actually consented to (may differ from requested) |
| `tokenType` | text | no | Practically always `Bearer` |
| `refreshGeneration` | integer | no | Increments on each successful rotation — the hook for reuse detection (§ 6.6) |
| `selectedResource` | json (`{ id, name, type? }`) | no | Result of Resource Selection; e.g. Xero's chosen Organisation |
| `obtainedAt` | datetime (ISO) | yes | For diagnostics and for age-based reauth prediction |

**Domain invariants:**
- A Connection has at most one active Token Set. (Enforced by the existing `IntegrationCredentials` uniqueness over `(integration_id, organization_id, tenant_id, user_id)`.)
- A refresh for one Connection is serialized cluster-wide: **at most one in-flight refresh per Connection**, regardless of process count.
- `reauthRequired = true` ⟺ the stored refresh token is believed permanently unusable. It is set only on a definitive `invalid_grant`-class failure, never on a transient network/5xx error (§ 6.7) — a false positive here nags an operator for nothing, a false negative silently starves the integration.
- A Token Set is never written to a log, a URL, a run parameter, or a telemetry attribute. (`IntegrationLog` already strips secret fields; run parameters are documented as clear-text, so tokens must never travel that path.)
- PKCE is used unless the descriptor explicitly opts out with a recorded reason.

**Access control:** no new ACL features. Connect/disconnect is `integrations.credentials.manage`; viewing connection state is `integrations.view`; per-user Connections additionally follow the existing per-user credential scoping.

#### Checklist
- [x] Paying customer identified (tenant buys time-to-connected; maintainers buy marginal cost per provider)
- [x] Flywheel articulated as a reinforcing loop
- [x] Primary goal has three measurable outcomes, each with a today-baseline
- [x] Scope exclusions listed with reasons, including the SSO boundary
- [x] Every domain term defined once; "Connection" explicitly disambiguated from `channelId`
- [x] Entity/structure fields defined precisely with type, multi-value and required flags
- [x] Invariants documented, including the two (refresh serialization, reauth semantics) that are the whole point of the capability
- [x] Access control documented — reuse, no new features

---

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---|---|---|---|---|---|
| OM Admin | holder of `integrations.credentials.manage` | internal | one OM tenant+organization | Integration detail page: connection status, connected resource name, reauth prompt | Enters app credentials, connects, selects the Resource, disconnects, reconnects |
| OM Staff user (per-user Connections) | holder of `communication_channels.connect_user_channel` or equivalent per-provider feature | internal | own user within a tenant | Their own Connection's status | Connects/disconnects **their own** mailbox-style Connection (existing per-user credential scoping) |
| Integration Developer | **none — not a runtime persona** | N/A | N/A | N/A | Authors a Provider Descriptor at build time. Consumes this toolkit's API; never authenticates against it. Listed here only so the reader does not go looking for a missing identity |

**External-surface decision framework:** N/A — no persona here is external to the operating organization. This is operator-facing infrastructure.

**Portal decision: NOT USED.**

**If NOT USED — why:** all personas are internal staff working in the admin backend; there is no end-customer-facing surface. A customer-portal user has no reason to see, let alone manage, a tenant's accounting/CRM OAuth connections.

**Decision log:** Both runtime personas are internal because both need the integration marketplace and its credential forms — surfaces that exist only on the internal backend. The per-user persona is not a second identity type: it is the *same* internal identity with the existing `scope.userId` credential scoping, which is why no "maybe both" case arises.

#### Checklist
- [x] Every persona has ONE identity type — internal (developer explicitly marked as a non-persona)
- [x] Identity decision justified per persona from the capabilities they need
- [x] No persona has two accounts; per-user scoping explicitly shown not to be a second identity
- [x] Org scoping defined per persona
- [x] Portal decision justified (single-surface fact recorded; tree N/A)

---

## 3. Workflows `PM`

### WF1: An integration developer adds a new OAuth2 provider

**Journey:** developer writes an `OAuth2ProviderDescriptor` in the provider package -> declares the existing `oauth` credential field on the `IntegrationDefinition` -> `yarn generate` -> the Integrations admin UI renders a working Connect button, and the generic routes handle authorize/callback/refresh/disconnect -> developer writes only what is genuinely provider-specific (a Resource Selection hook, if any).

**ROI:** the OAuth portion of a new provider integration drops from ~5 atomic commits of protocol plumbing (the Xero App Spec's own WF1 estimate) to ≤2 — and the 3 commits saved are precisely the ones where PKCE/CSRF/refresh bugs would otherwise be re-introduced. At the current cadence of OAuth2 providers in flight (Gmail shipped, Google Workspace + Xero drafted), that is ~9 commits and three chances to get security wrong, avoided.

**Key personas:** Integration Developer (build-time).

**Boundaries:**
- Starts when: a new provider package needs third-party API access via OAuth2.
- Ends when: an admin can complete WF2 against that provider with no provider-specific protocol code in the repo.
- NOT this workflow: non-OAuth providers, provider *business* logic (the sync adapter itself), user-login SSO.

**Edge cases:**
1. Provider publishes no discovery document -> descriptor declares `authorizationUrl`/`tokenUrl` explicitly; toolkit must not require `issuer`.
2. Provider is non-compliant and rejects PKCE -> descriptor sets `usePkce: false` **with a recorded justification**; toolkit must not silently downgrade on an error (§ 6.4).
3. Provider needs a post-consent Resource Selection (Xero) -> descriptor declares the hook; a provider that doesn't need it writes nothing.
4. Provider's token response omits `expires_in` -> no `expiresAt` stored; refresh becomes reactive (on 401) rather than proactive. Must not be treated as "never expires".
5. Two providers in one bundle share one app credential pair (Google Workspace's bundle) -> descriptor resolution must honour the existing bundle credential fallthrough rather than reimplementing it.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Declare descriptor + register | `integrations` registry, `yarn generate` auto-discovery | Partial | New descriptor type + discovery of it |
| Render Connect button | `oauth` credential-field type exists but is refused by the UI (§ 0.3 #8) | **Yes** | Finally implementing the dead field type is the highest-leverage UI change here |
| Generic authorize/callback routes | none generic today | **Yes** | The core of this toolkit |
| Protocol mechanics (PKCE, `iss`, token auth methods) | `openid-client`, already in-repo but only in `enterprise` (§ 0.3 #6) | Partial | Add the dependency to `core` and wrap it; do not hand-roll (§ 6.2) |

### WF2: An admin connects a tenant's account

**Journey:** admin opens the provider's Integration detail page -> enters Client ID/Secret -> clicks Connect -> toolkit builds a PKCE + `state` authorization URL and sets the state cookie -> provider consent screen -> callback verifies `state`/`iss`, exchanges the code with `code_verifier`, stores the encrypted Token Set -> if the descriptor declares Resource Selection, admin picks the remote resource -> status shows Connected.

**ROI:** identical connect UX across every provider, so an admin who has connected one OM integration can connect any of them; and the flow is PKCE-protected by construction rather than per-provider diligence.

**Key personas:** OM Admin (or Staff user for per-user Connections).

**Boundaries:**
- Starts when: an enabled integration has app credentials but no valid Token Set.
- Ends when: an encrypted Token Set (and a selected Resource, if applicable) is stored and `reauthRequired` is false.
- NOT this workflow: the ongoing token refresh (WF3), reauthorization after failure (WF4), the provider's own business sync.

**Edge cases:**
1. Callback arrives with a `state` that doesn't decrypt, is expired (>5 min), or belongs to a different user/session -> rejected with a stable error code, **no token exchange attempted**, nothing stored.
2. Callback arrives with an `iss` that doesn't match the descriptor's expected issuer -> rejected (mix-up defense, RFC 9207) before the code is sent anywhere.
3. User denies consent, or closes the provider tab -> no Token Set written, state cookie expires harmlessly; the integration stays "Not connected" with no partial row.
4. Provider returns no refresh token (user re-consented and the AS only issues one on first grant — a classic Google behavior, hence `prompt=consent`) -> **must be detected and surfaced**, not stored as a Connection that will silently die at the first access-token expiry.
5. Two admins connect the same integration concurrently in two browsers -> last write wins on one `IntegrationCredentials` row; the loser's tokens are orphaned at the provider. Acceptable, but the second admin must see the resulting state, not a stale "connected as X" (§ 5 impact matrix).
6. Resource Selection returns exactly one option -> auto-select it rather than forcing a pointless click; returns zero -> a clear error, not an empty picker.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Credential form | `integrations` Credentials tab | No | Reuse |
| Connect button | — | **Yes** | Via the `oauth` field type (WF1) |
| PKCE + state + authorize URL | `oauth-state.ts` (state only, generic today); `openid-client` (PKCE) | Partial | Compose, don't invent |
| Code exchange | `oauth-token.ts` generic today; `openid-client` does it with `iss`/PKCE checks | Partial | Prefer the library path (§ 6.2) |
| Encrypted storage | `integrationCredentialsService` | No | Reuse verbatim |
| Resource Selection UI | — | **Yes** | Generic picker driven by the descriptor hook |

### WF3: A provider API call transparently gets a valid access token

**Journey:** a provider's adapter/worker asks the toolkit for a usable access token for a Connection -> toolkit returns the current one if it is comfortably valid -> otherwise acquires the cross-process Refresh Lock, re-reads the Token Set (another process may have just refreshed), refreshes only if still needed, persists the rotated Token Set, releases the lock, returns the new token.

**ROI:** this is the workflow that makes unattended integrations actually stay connected. It closes the "the sync mysteriously needs reauthorization every few days" failure class that rotating-refresh-token providers produce under concurrency.

**Stated precisely, because the honest version is more useful than the dramatic one (§ 0.3 #11):** Google does not rotate refresh tokens, so Gmail is **not** flapping today — the cross-process race is real but currently *latent*. It becomes *active* with the first rotating-refresh provider, and Xero (already specced and in flight) is exactly that. So the ROI here is preventing a guaranteed incident on a provider about to ship, not cleaning up a current one; the fix happening to cover Gmail retroactively is a bonus, not the argument.

**Key personas:** none interactive — system/worker path. (Its failure is what WF4 makes visible to a persona.)

**Boundaries:**
- Starts when: any code path needs an access token for a Connection.
- Ends when: a valid access token is returned, or a typed failure is raised (transient vs. reauth-required).
- NOT this workflow: the provider's own rate limiting/retry of its business calls (that stays in the provider adapter, per `data_sync`'s "no provider specifics in the generic module" rule).

**Edge cases:**
1. **Two processes need a refresh simultaneously** (the whole point): one wins the lock and rotates; the other waits, re-reads, and uses the winner's new token — it must **not** exchange the now-invalidated refresh token.
2. Lock holder crashes mid-refresh -> the lock must not be held forever: it is bounded (advisory lock tied to a session/transaction, or a TTL), and the next caller retries cleanly.
3. Refresh returns a new refresh token (rotation) -> persisted atomically with the access token; `refreshGeneration` increments. A partial write that stored the access token but lost the new refresh token would brick the Connection at the next refresh.
4. Refresh fails transiently (network, 5xx, timeout) -> retried with backoff; **`reauthRequired` stays false** (§ 6.7).
5. Refresh fails definitively (`invalid_grant`) -> `reauthRequired = true`, Connection marked, error reported once (not once per call), WF4 takes over.
6. Token has no `expiresAt` -> proactive refresh is impossible; a 401 from the provider triggers one forced refresh-and-retry, and a second 401 is a real failure rather than an infinite loop.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Read/persist Token Set | `integrationCredentialsService` | No | Reuse |
| Decide "needs refresh" | `credential-refresh.ts` logic exists | Partial | Reusable once detached from `ChannelAdapter` |
| **Cross-process lock** | in-process `Map` only today (§ 0.3 #3) | **Yes** | The single most important correctness gap; § 6.6 picks the mechanism |
| Perform refresh | `openid-client` refresh grant | Partial | Library path |
| Classify failure | — | **Yes** | Transient vs. reauth taxonomy (§ 6.7) |

### WF4: A broken Connection surfaces itself and is repaired

**Journey:** a definitive refresh failure (or the 15-minute health probe) sets `reauthRequired` -> the integration detail page shows a Reconnect prompt and health turns unhealthy -> admin clicks Reconnect -> WF2 runs again -> `reauthRequired` clears and schedules resume.

**ROI:** bounds the blast radius of the one unavoidable long-term failure (refresh tokens do eventually die) to ≤15 minutes of detection latency instead of "until someone notices the data is stale" — which, for an accounting or CRM sync, can be weeks.

**Key personas:** OM Admin.

**Boundaries:**
- Starts when: a refresh fails definitively, or a health probe finds the Connection unusable.
- Ends when: the admin reconnects, or deliberately disconnects.
- NOT this workflow: transient failures (WF3 edge case 4), which must never reach here.

**Edge cases:**
1. Reauth needed while a long-running sync is mid-flight -> the sync's current run fails per its own module's failure handling; the toolkit's job is only to classify and flag, not to cancel other modules' work.
2. Admin reconnects and the provider returns a Token Set for a **different** remote resource than before (different Xero Organisation, different Slack workspace) -> must be surfaced, because every existing external-id mapping was built against the old one. The toolkit knows `selectedResource`, so it can detect the change and warn — a capability the Xero App Spec currently lists as an unmitigated open question.
3. Health probe and a real API call both detect failure at once -> `reauthRequired` set idempotently, error reported once.
4. Provider's refresh token is revoked by the *user* in the provider's own console -> indistinguishable from expiry, and correctly handled identically.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Flag reauth | `IntegrationState.reauthRequired` | No | Existing column |
| Health probe | `integrationHealthService` (15 min) | No | Reuse; toolkit supplies a generic OAuth health check |
| Reconnect UI | WF2's Connect flow | No | Same surface |
| Detect changed resource | `selectedResource` in the Token Set | Partial | Small comparison + warning |

### WF5: An admin disconnects, and the tokens are actually gone

**Journey:** admin clicks Disconnect -> toolkit calls the provider's revocation endpoint when the descriptor declares one -> **clears the stored Token Set** -> sets `isEnabled=false`/pauses dependent schedules -> UI shows Not connected.

**ROI:** today's disconnect is a trust defect twice over (§ 0.3 #13). It nulls the channel's `credentialsRef` pointer but **leaves the `integration_credentials` row in place**, so an encrypted, still-valid refresh token remains at rest after the tenant believes access is gone — and nothing is revoked provider-side, so OM keeps appearing in the user's "connected apps" list with live access. Fixing both is a genuine security improvement and the kind of item a customer security review asks about directly.

**Key personas:** OM Admin (or Staff user for their own Connection).

**Boundaries:**
- Starts when: admin requests disconnect.
- Ends when: local Token Set is gone and (where supported) the remote grant is revoked.
- NOT this workflow: deleting the integration's *business* data (imported records stay; that is each provider's own decision — the Xero App Spec, for instance, deliberately keeps its external-id mappings).

**Edge cases:**
1. Revocation endpoint returns an error or times out -> **local credentials are still cleared**; the failure is logged, not fatal. Refusing to disconnect locally because a remote call failed would trap the tenant.
2. Descriptor declares no `revocationUrl` -> local clear only, and the UI says so honestly rather than implying remote revocation happened.
3. Disconnect races an in-flight refresh -> the Refresh Lock serializes them; a refresh that completes after the clear must not resurrect a Token Set (write-after-delete must lose).
4. Per-user Connection disconnected by an admin rather than its owner -> permitted only with the manage feature, and scoped to the right `userId` row so it doesn't clear the tenant-wide row instead.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| **Actually clear the Token Set** (not just a pointer) | `integrationCredentialsService` exists; today's disconnect doesn't use it this way (§ 0.3 #13) | **Yes** | The service is there; the behavior isn't |
| Disable + pause schedules | `IntegrationState`, `data_sync` schedules | No | Existing behavior |
| **Remote revocation (RFC 7009)** | none anywhere in the repo (§ 0.3 #13) | **Yes** | Small: one descriptor-driven POST, non-fatal |

#### Checklist (overall)
- [x] 5 core workflows defined, each tracing to a measurable ROI
- [x] Boundaries with explicit start/end/NOT for each
- [x] 4-6 high-probability production edge cases each (concurrency, partial writes, missing refresh token, changed resource, revocation failure)
- [x] Every step mapped to a platform capability with gaps flagged
- [x] Production reality check: WF1-WF5 together let a client run an unattended OAuth integration — WF3+WF4 are precisely what "unattended" requires, which is why they are not deferred

---

## 3.5 UI Architecture `PM + UX`

### Navigation (per role)

| Role | Sidebar groups | Notes |
|---|---|---|
| OM Admin | Existing **External Systems -> Integrations** | No new navigation. The toolkit's UI is entirely inside the existing integration detail page |
| OM Staff user (per-user Connections) | Existing **Profile -> Communication channels** (or the provider's own surface) | Unchanged; the per-user connect surface keeps its current home |

### Dashboard Widgets

None new. Connection health already flows into the existing integrations health surface; a dedicated "OAuth connections" dashboard widget would duplicate it.

### Custom Pages

None. This is the point: the toolkit adds *generic* behavior to the existing integration detail page rather than a page per provider.

| Page | URL pattern | Role | Purpose | Building block |
|---|---|---|---|---|
| Integration detail (enhanced) | `/backend/integrations/[id]` (existing) | Admin | Connect / Reconnect / Disconnect, connected-resource display, reauth banner | Existing page + the now-implemented `oauth` credential field renderer |

### Widget Injections

| Widget | Injects into | Injection spot | Data |
|---|---|---|---|
| OAuth connect/status control (generic, provider-agnostic) | Integration detail page, Credentials tab | Rendered by the credential-field renderer for `type: 'oauth'` (no per-provider widget needed) | Connection status, connected resource name, `reauthRequired`, last refresh |
| Resource Selection picker (generic) | Integration detail page, post-callback | Same renderer, shown only when the descriptor declares `resourceSelection` | Options from the descriptor's hook |

> Per-provider Connect widgets (what `channel-gmail` ships today, and what the Xero and Google Workspace specs each plan to build) become unnecessary. That is the UI-side ROI.

### Key User Flows

| Persona | Task | Flow (login -> done) | Clicks | Notes |
|---|---|---|---|---|
| OM Admin | Connect a provider | Login -> Integrations -> provider card -> enter credentials -> Connect | 3 (+ provider's own consent screen) | Identical for every provider — the consistency is the feature |
| OM Admin | Reconnect after reauth | Login -> Integrations -> provider card (reauth banner visible) -> Reconnect | 3 | Banner makes the needed action obvious without hunting |
| OM Staff user | Connect own mailbox | Login -> Profile -> Communication channels -> Connect | 3 | Unchanged from today |

### Empty States

| Page/Widget | Empty state message | Action |
|---|---|---|
| OAuth field, no app credentials yet | "Enter your Client ID and Secret to enable connecting." | Inline credential fields; Connect disabled with an explanatory tooltip (never hidden) |
| OAuth field, credentials but no Connection | "Not connected." | **Connect** button |
| OAuth field, reauth required | "Connection expired — reconnect to resume syncing." | **Reconnect** button |
| Resource Selection, zero options | "No organisations available on this account." | Link to provider docs; no empty picker |

#### Checklist
- [x] Every persona has a login-to-primary-task flow at ≤3 clicks
- [x] Navigation grouping unchanged — no new surfaces to learn
- [x] Empty states guide (including the disabled-with-tooltip rule, never hidden)
- [x] Custom pages: none — existing building blocks only
- [x] No portal pages (§ 2 rejects the portal)

---

## 4. Workflow Gap Analysis `Architect`

### Gap Scoring — Atomic Commits (0 = platform does it; 5 = 5+ commits / external dependency)

#### WF1: Developer adds a provider — Total: 4 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| `OAuth2ProviderDescriptor` type + registry wiring + generator discovery | `integrations` registry, `yarn generate` | 2 | platform | 2 | Additive type + discovery; follows the existing `integration.ts` convention |
| Implement the `oauth` credential-field renderer (removing it from `UNSUPPORTED_CREDENTIAL_FIELD_TYPES`) | dead declarative surface today (§ 0.3 #8) | 2 | platform | 2 | Generic Connect/status/Reconnect control + i18n |

#### WF2: Admin connects — Total: 5 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Add `openid-client` to `core` + a thin `OAuth2Client` wrapper (discovery or manual metadata, PKCE, `iss`, client-auth methods) | in-repo precedent in `enterprise` (§ 0.3 #6), not yet in `core` | 3 | platform | 2 | Dependency addition needs the "Ask First" nod (§ 6.2, § 10 #2) |
| Generic `initiate` / `callback` / `disconnect` routes under `/api/integrations/oauth/[provider]/*` | none generic | 3 | platform | 2 | Includes state-cookie issue/verify and the callback error taxonomy |
| Resource Selection hook + generic picker | none | 2 | platform | 1 | Descriptor-driven; Xero is the first consumer |

#### WF3: Transparent token refresh — Total: 4 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| `getAccessToken(connection)` service: validity check, re-read-under-lock, rotate, persist atomically | `credential-refresh.ts` logic exists but is `ChannelAdapter`-typed (§ 0.3 #4) | 2 | platform | 1 | Largely a re-home + detach of existing, working logic |
| **Cross-process Refresh Lock** | pattern has 6 in-repo precedents but no helper exists (§ 0.3 #12); in-process `Map` only today (§ 0.3 #3) | 3 | platform | 2 | One commit for a reusable `withAdvisoryLock()` in `shared`, one to wire it into refresh. Mechanism decided in § 6.6 |
| Failure taxonomy (transient vs. reauth) + single-report semantics | — | 1 | platform | 1 | Small, but it is what keeps `reauthRequired` trustworthy |

#### WF4: Reauth surfacing — Total: 2 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Generic OAuth health check registered for any OAuth provider | `integrationHealthService` + 15-min probe | 1 | platform | 1 | Reuses the probe wholesale |
| Changed-`selectedResource` detection + warning | — | 1 | platform | 1 | Also closes an open question in the Xero App Spec |

#### WF5: Disconnect with revocation — Total: 1 atomic commit

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Descriptor-driven RFC 7009 revocation, non-fatal on failure | none today | 1 | platform | 1 | One POST + error swallowing, plus honest UI copy when unsupported |

#### Test infrastructure (US-0.1 — not a workflow, but unscored in the first draft) — Total: 2 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| A fake authorization server for tests (PKCE round-trip, `state`/`iss` rejection, rotation, concurrent-refresh serialization, `invalid_grant` -> reauth, revocation) | **none — no mock AS, no HTTP double, and no test anywhere exercises a real OAuth round-trip** (§ 0.3 #14) | 3 | platform | 2 | Added after the audit corrected the assumption that fixtures existed. Without this, the Phase 2 concurrency guarantee is unprovable, which would make it a claim rather than a criterion |

#### Migration (not a workflow — a prerequisite for calling this done) — Total: 3 atomic commits

| Step | Gap | Scope | Commits | Notes |
|---|---|---|---|---|
| Re-home `oauth-state.ts`/`oauth-token.ts` into the toolkit with BC re-export shims at the old paths | 2 | platform | 1 | `channel-gmail` imports the old paths today (§ 0.3 #5); shims per `BACKWARD_COMPATIBILITY.md` |
| Migrate `channel-gmail` onto the toolkit (gaining PKCE) without invalidating live Connections | 3 | platform | 2 | Existing Token Sets must keep working; see § 6.8 |

### Gap Summary

| Workflow | Business Priority | Atomic Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|---|---|---|---|---|---|
| WF1 Developer adds provider | High | 4 | No | 4 | Yes — the developer-velocity ROI is this workflow |
| WF2 Admin connects | High | 5 | No | 5 | Yes — nothing works without it |
| WF3 Transparent refresh | **High** | 4 | No | 4 | Yes — this is the "stays connected" ROI and the correctness fix |
| WF4 Reauth surfacing | Medium | 2 | Partially — `reauthRequired` can be set by hand by a provider today | 2 | No, but silent staleness without it |
| WF5 Disconnect + revoke + actually clear tokens | Medium-**High** (security) | 1 | No — today's disconnect leaves a valid refresh token at rest (§ 0.3 #13) | 1 | No for function, **yes for the security claim** |
| Test infrastructure (fake AS) | High | 2 | No | 2 | Yes — Phase 2's concurrency criterion is unprovable without it |
| Migration (Gmail + re-home) | High | 3 | No | 3 | Yes — without it the duplication this spec exists to remove survives |

**Total: 21 atomic commits** (19 in the first draft, +2 after the audit found no test infrastructure to build on). Every gap is `platform`-scoped: this capability *is* a platform contribution, not an app feature — which means the whole thing needs maintainer buy-in before Phase 1, not merely a code review (§ 10 #2).

#### Checklist
- [x] Every workflow step scored in atomic commits
- [x] Scope column honest: all `platform`, flagged as needing upstream buy-in
- [x] Migration counted as real work rather than assumed free
- [ ] Architect checkpoint — dispatched for this document (see § Changelog)

---

## 4.5 Module Architecture `Architect`

### Platform capabilities used

| Capability | Usage | Extension points used | Notes |
|---|---|---|---|
| `integrations` registry | extend | `IntegrationDefinition`, new `OAuth2ProviderDescriptor` | The toolkit's home |
| `integrationCredentialsService` | as-is | `resolve`/`save`/`saveField`, `scope.userId`, bundle fallthrough | Encrypted Token Set storage — unchanged |
| `IntegrationState` | as-is | `reauthRequired`, health fields | Reauth + health, unchanged |
| `integrationHealthService` | extend | `healthCheck.service` | One generic OAuth checker serving every provider |
| `IntegrationLog` | as-is | secret-stripping log writes | Connect/refresh/revoke audit trail |
| Admin credential form | extend | credential-field renderer | Implements `type: 'oauth'` (§ 0.3 #8) |
| `openid-client` (npm) | use | discovery, PKCE, `iss`, token/refresh/revoke grants | Already in-repo via `enterprise`; add to `core` (§ 6.2) |
| Postgres advisory locks / equivalent | use | Refresh Lock | Mechanism selected in § 6.6 |
| `data_sync` schedules | as-is | pause on disable | Disconnect behavior, unchanged |

### Shared modules

| Module | Status | Usage | Extension points | Rationale |
|---|---|---|---|---|
| `integrations` | EXISTING | extend | registry + credential field + health | Its own AGENTS.md calls it "the foundation layer for all external connectors" — an OAuth2 client toolkit is foundation-layer by definition, and placing it here is what lets every hub (`data_sync`, `communication_channels`, `payment_gateways`, …) use it without cross-hub imports |
| `communication_channels` | EXISTING | **shrinks** | — | Loses its accidental role as the de-facto OAuth utility host; keeps its channel-specific concerns. Gains PKCE for Gmail as a side effect |
| `enterprise/sso` | EXISTING | untouched in Phases 1-3 | — | Different use case (§ 6.5). Optional Phase 4 de-duplication of the state cookie only, in the allowed enterprise→core direction |

### App modules

None — this spec creates no app module. It is a platform capability inside an existing core module. (Per the template's rule, a spec with >2 app modules owes an explanation; zero needs none.)

#### Checklist
- [x] Every capability listed with usage type and extension points
- [x] Every capability traces to a workflow — no template-default entries
- [x] No new module proposed where an existing foundation module fits
- [x] Reusability check: the toolkit is *itself* the extraction of a reusable pattern; § 6.3 justifies `integrations` over `communication_channels` or a new package
- [x] No direct modification of another module's internals except the deliberate, BC-shimmed re-home (§ 4 Migration)
- [x] Boundaries align with bounded contexts: third-party *API access* here, user *login* in `sso` (§ 6.5)

---

## 5. User Stories `PM`

### WF1: Developer adds a provider

**US-1.1** As an Integration Developer, I declare a provider descriptor and get a working, PKCE-protected connect flow without writing protocol code, so that adding a provider is a configuration task.
Success: a new provider with `issuer` (or explicit URLs) + `scopes` yields a working Connect button, callback, refresh and disconnect, with zero lines of authorize-URL or token-exchange code in the provider package.
**Happy path:** descriptor + `yarn generate` -> Connect button appears -> full WF2 works.
**Alternate paths:** provider needs quirks (comma scopes, `client_secret_post`, extra authorize params) -> expressed declaratively in the descriptor, still no protocol code. Provider needs Resource Selection -> one hook implemented, everything else still generic.
**Failure paths:** descriptor omits both `issuer` and `authorizationUrl`/`tokenUrl` -> **build/registration-time validation error naming the missing field**, not a runtime failure discovered by an admin mid-consent. Descriptor declares a `revocationUrl` the provider doesn't have -> disconnect logs a revocation failure and still clears locally (WF5 edge 1).

**US-1.2** As an Integration Developer, I can opt a provider out of PKCE only deliberately, so that a non-compliant provider is supported without quietly weakening every other provider.
Success: `usePkce: false` requires an accompanying justification comment/field; the default with no declaration is PKCE **on**.
**Happy path:** developer omits `usePkce` entirely -> PKCE is used.
**Alternate paths:** a genuinely non-compliant provider -> explicit opt-out, recorded, and visible in review.
**Failure paths:** provider rejects the PKCE parameters at runtime despite `usePkce: true` -> the connect attempt fails with a clear error pointing at the descriptor; the toolkit **must not** auto-retry without PKCE, because a silent downgrade is exactly the attack a downgrade defense exists to prevent (§ 6.4).

### WF2: Admin connects

**US-2.1** As an OM Admin, I connect our account for any OAuth provider through the same Connect flow, so that I don't relearn a bespoke UI per integration.
Success: Client ID/Secret entered, Connect clicked, consent completed, status reads Connected with the connected resource named.
**Happy path:** as above, one provider organisation/account.
**Alternate paths:** provider returns several selectable resources -> picker; exactly one -> auto-selected without a pointless click.
**Failure paths:** consent denied -> "Not connected", no partial row, no orphaned state. State cookie expired (took >5 min on the consent screen) -> clear "the connect attempt timed out, please try again", **no code exchanged**. `iss` mismatch -> rejected as a security error and logged; the admin sees a generic failure, the log carries the detail.

**US-2.2** As an OM Admin, I am told when a provider gave us no refresh token, so that I don't discover a dead connection an hour later.
Success: a Token Set arriving without a refresh token (for a provider whose descriptor expects one) surfaces a warning at connect time naming the likely cause (already-granted consent) and the fix (revoke in the provider's console and reconnect, or force re-consent).
**Happy path:** refresh token present -> no warning.
**Alternate paths:** provider legitimately never issues refresh tokens -> descriptor says so; no warning, and the Connection is understood to be short-lived.
**Failure paths:** warning ignored -> the Connection works until the access token expires, then WF4's reauth path engages normally rather than failing obscurely.

### WF3: Transparent refresh

**US-3.1** As a provider adapter (system actor), I request an access token and receive a valid one, without knowing whether a refresh happened.
Success: a valid token is returned; at most one refresh per Connection happens cluster-wide even under concurrent demand; a rotated refresh token is persisted before the call returns.
**Happy path:** token still valid -> returned as-is, no lock taken, no provider round-trip.
**Alternate paths:** near expiry -> lock, re-read, refresh, persist, return. Another process refreshed a moment earlier -> re-read finds a fresh token and **no second refresh is performed**.
**Failure paths:** transient refresh failure -> typed transient error, backoff, `reauthRequired` untouched. Definitive `invalid_grant` -> typed reauth error, `reauthRequired = true`, reported once. Lock acquisition times out -> typed transient error (the caller retries) rather than a refresh attempted without the lock.

**US-3.2** As an OM maintainer, a crashed process cannot deadlock a Connection's refresh forever.
Success: a lock whose holder dies is released automatically (session-scoped advisory lock or TTL), and the next caller proceeds normally.
**Happy path:** normal release on completion.
**Alternate paths:** lock contention under load -> waiters queue briefly and then use the winner's token.
**Failure paths:** holder crashes -> lock released by the mechanism (not by a manual operator step); next refresh succeeds. **No path leaves a Connection permanently unrefreshable.**

### WF4: Reauth surfacing

**US-4.1** As an OM Admin, I see within ~15 minutes that a connection needs reauthorization, so that data staleness is bounded.
Success: `reauthRequired` visible as a banner + unhealthy health status; reconnect from the same page.
**Happy path:** banner appears, admin reconnects, banner clears, schedules resume.
**Alternate paths:** the health probe detects it before any business call does -> identical UX.
**Failure paths:** admin ignores the banner -> integration stays flagged and unhealthy; no silent "everything is fine" state is ever shown.

**US-4.2** As an OM Admin, if I reconnect to a *different* remote resource than before, I am warned, so that I don't silently re-point an integration whose historical data was built against the old one.
Success: a changed `selectedResource` on reconnect produces an explicit confirmation naming both old and new resource.
**Happy path:** same resource -> no warning.
**Alternate paths:** deliberate switch -> admin confirms; the warning is not a block.
**Failure paths:** admin confirms by accident -> the Connection is re-pointed, and the warning text is what makes the consequence discoverable afterwards in the log. (Undoing downstream data effects is each provider's concern, not the toolkit's — stated so no one assumes otherwise.)

### WF5: Disconnect

**US-5.1** As an OM Admin, disconnecting actually revokes our access at the provider where possible, so that "disconnected" means disconnected.
Success: revocation called when declared; local Token Set cleared unconditionally; UI honest about which of the two happened.
**Happy path:** both succeed.
**Alternate paths:** provider has no revocation endpoint -> local clear, UI says access was cleared locally only.
**Failure paths:** revocation call fails/times out -> local clear still completes, failure logged; the admin is not trapped in a half-connected state.

### Default User Stories

**US-0.1** As someone evaluating or testing this toolkit, I can exercise a full connect/refresh/reauth cycle without a real third-party account, so that OAuth behavior is testable in CI.
Success: a fake authorization server (or recorded fixtures) lets tests cover: PKCE round-trip, `state` rejection, `iss` rejection, rotation, concurrent-refresh serialization, `invalid_grant` -> reauth, and revocation-on-disconnect. (§ 10 #5 tracks whether an AS mock already exists in the repo.)

**US-0.2** N/A — this capability seeds no demo domain data; its "demo data" is the fake AS above.

### Cross-Story Impact Matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|---|---|---|---|---|
| US-3.1 (refresh rotates the Token Set) | `IntegrationCredentials.credentials` replaced | US-3.1 in another process, US-5.1 | Two processes rotating concurrently invalidate each other's refresh token — the failure this capability exists to fix | Cross-process Refresh Lock + re-read-under-lock (§ 6.6); `refreshGeneration` makes a reuse attempt detectable rather than merely unlucky |
| US-5.1 (disconnect clears the Token Set) | credentials cleared | US-3.1 in flight | A refresh completing *after* a disconnect could re-persist a Token Set for a Connection the admin believes is gone | Disconnect takes the same Refresh Lock; a post-clear write must lose (write-after-delete detection), stated as an invariant in § 1.4 |
| US-2.1 (two admins connect concurrently) | one credentials row, last write wins | US-2.1 (the other admin), US-3.1 | The losing admin's tokens are orphaned at the provider and the UI could show a stale "connected as" | The credentials row already supports optimistic locking via `resolveUpdatedAt`; connect writes should use it so the second admin gets a conflict they can see, not a silent overwrite (§ 10 #4) |
| US-4.2 (reconnect to a different resource) | `selectedResource` changes | every provider's own external-id mappings (e.g. the Xero App Spec's `SyncExternalIdMapping` rows) | Historical mappings reference the old resource; syncs would treat everything as new | The toolkit detects and warns (US-4.2); the *data* consequence stays each provider's responsibility, explicitly, so neither side assumes the other handles it |
| US-1.2 (`usePkce: false`) | weaker security for one provider | every other provider | A per-provider opt-out must never become a global default or a silent runtime fallback | Default-on; explicit justification required; **no runtime auto-downgrade** (US-1.2 failure path) |
| Migration (Gmail moves onto the toolkit, gaining PKCE) | Gmail's authorize/exchange path changes | live Gmail Connections | A migration that invalidates stored Token Sets would silently break every tenant's email channel | Stored Token Sets must keep working untouched — PKCE affects only *new* authorization flows, not existing refresh tokens (§ 6.8); phase gated behind that being proven in a test |

#### Checklist (domain stories)
- [x] Every story: persona (or explicit system actor) + action + measurable outcome + success criteria
- [x] Every story has alternate and failure paths; N/A cases say why
- [x] Every story traces to a workflow
- [x] Identity checkpoint: US-1.x is a build-time developer (non-persona, § 2), US-3.x is a system actor, the rest are internal admin/staff
- [x] No weak verbs — no "manage"/"handle"/"track"
- [x] Cross-story impact matrix covers every story, including the migration, with named mitigations rather than deferrals

---

## 6. Decisions Requested `PM + Architect`

### 6.1 Build a toolkit at all, or just narrow one type?

| Option | Description | Trade-off |
|---|---|---|
| **A — Narrow `credential-refresh.ts` only** (the earlier `.ai/specs/2026-09-26-oauth2-provider-toolkit-reuse.md`) | One type change so non-channel providers can reuse refresh coalescing | Cheapest by far (~1 commit, zero BC risk) and genuinely useful. But it fixes **none** of: no PKCE anywhere, in-process-only locking, dead `oauth` field type, per-provider authorize-URL boilerplate, no revocation. It makes the *existing* weaknesses reusable |
| **B — Full toolkit (this spec)** | Descriptor + generic routes + PKCE + cross-process lock + revocation + Connect UI, with Gmail migrated | 19 commits, all platform-scoped, needs maintainer buy-in. Pays down the duplication before it becomes 4-5 copies, and fixes the security baseline once for everyone |
| C — Toolkit, but skip the Gmail migration | Ship the toolkit for new providers only, leave Gmail hand-rolled | Cheaper (-3 commits) but leaves two protocol paths forever, and the one *live* provider keeps its no-PKCE flow — i.e. the security goal isn't actually met |

**Recommendation: B.** The deciding argument is timing: there are two OAuth2 integrations *in design right now* (Xero, Google Workspace) and each will otherwise hand-roll a third and fourth protocol layer. Option A remains the correct fallback if maintainers decline the platform work — it is strictly better than nothing and is not wasted if B lands later.

### 6.2 Build the protocol layer, or adopt `openid-client`?

| Option | Trade-off |
|---|---|
| Hand-roll (status quo, extended) | No new dependency. But OM would be maintaining PKCE, `iss` checks, client-auth methods, discovery, and revocation by hand — the exact code the industry has converged on not writing. Gmail's missing PKCE is evidence of how this goes |
| **Adopt `openid-client` in `core`** | Already in this repo at `packages/enterprise` ^6.8.4, already used correctly with PKCE and discovery by `sso/lib/oidc-provider.ts`, already Jest-mocked there. OpenID-certified, actively maintained. Gets `iss`, client-auth methods, and future DPoP/PAR for free. Costs: a production dependency added to `core` (root `AGENTS.md` **Ask First**), and it is OIDC-centric — non-OIDC providers need manually-supplied server metadata instead of discovery (supported, just less magic). ESM-only in v6, though `enterprise` already ships it so the build tolerates it |
| Adopt a lighter client (`arctic`, `@badgateway/oauth2-client`, `oauth4webapi`) | Less OIDC baggage; but a *new* dependency with no in-repo precedent, and `oauth4webapi` is the same author's lower-level library — choosing it over the one already vetted here needs a reason beyond taste |

**Recommendation: adopt `openid-client` in `core`**, wrapped in a thin OM-facing `OAuth2Client` so provider code never imports it directly (keeping a future swap cheap). The in-repo precedent makes this a much smaller ask than a novel dependency, and it converges the repo on **one** protocol engine instead of "certified in enterprise, hand-rolled in core".

### 6.3 Where does the toolkit live?

| Option | Trade-off |
|---|---|
| Stay in `communication_channels` (status quo) | Zero move cost. But conceptually wrong — an accounting sync importing from a chat/email/SMS module — and it keeps the hub as an accidental utility host |
| **`packages/core/src/modules/integrations/lib/oauth2/`** | `integrations` is self-described as the foundation layer for *all* external connectors; every hub already depends on it, so there is no cross-hub import. Costs a file move for `oauth-state.ts`/`oauth-token.ts` with BC re-export shims (`channel-gmail` imports the old paths today) |
| A new `packages/oauth2-toolkit` workspace package | Cleanest boundary in theory. But it would need its own build/test/release wiring, and it must reach `integrationCredentialsService` and `IntegrationState` anyway — i.e. it would depend on `core` and be used only by `core` consumers. Premature |

**Recommendation: split by dependency, not by feeling** — the audit's finding about the state-cookie duplication (§ 0.3 #7) makes a cleaner answer available than the original draft's single home:

| Piece | Home | Why |
|---|---|---|
| Pure protocol/crypto primitives: state-cookie encrypt/verify, token-endpoint POST, PKCE helpers, redirect-URI building | **`packages/shared/src/lib/oauth2/`** | These have **zero domain dependencies**, which is precisely `shared`'s stated charter ("cross-cutting utilities… MUST NOT import from `@open-mercato/core` or any domain package"). Putting them here is also what makes the optional Phase 4 SSO de-duplication trivial: `enterprise` already depends on `shared`, so one of the two duplicate state-cookie copies can simply go away without any import-direction gymnastics |
| The OM-integrated toolkit: descriptor registry, generic routes, credential storage, Refresh Lock, reauth classification, health check, Connect UI | **`packages/core/src/modules/integrations/lib/oauth2/`** (+ `api/oauth/[provider]/*`) | These necessarily reach `integrationCredentialsService`, `IntegrationState` and the admin UI — all core/`integrations` concerns, so they cannot live in `shared` |

Deprecation re-exports stay at the current `communication_channels/lib/oauth-{state,token}.ts` paths for ≥1 minor version per `BACKWARD_COMPATIBILITY.md`, since `channel-gmail` imports them today (§ 0.3 #5).

### 6.4 PKCE default

**Recommendation: on by default, per-provider opt-out with a recorded justification, and never an automatic runtime downgrade.** RFC 9700 and OAuth 2.1 both require PKCE for confidential clients; OM currently uses it in zero integration flows (§ 0.3 #1-2) while its own enterprise SSO module uses it correctly — an inconsistency worth ending. The no-auto-downgrade rule matters because a fallback-on-error path converts a defense into a negotiation an attacker can force.

### 6.5 Boundary with `enterprise/sso` — one OAuth layer or two?

**Recommendation: two, deliberately.** `sso` is OM acting as a relying party to authenticate **people** (short-lived, no stored refresh token for later API calls, identity claims mapped to OM users). This toolkit is OM acting as a client for **long-lived third-party API access** (stored rotating refresh tokens, background workers, per-tenant resource selection). Professional practice separates these (Auth.js vs Nango) because the lifecycles and threat models differ. **What is worth sharing is the state-cookie primitive only** — and since `enterprise` may import `core`, the de-duplication can go in that direction in an optional Phase 4, removing one of the two existing copies (§ 0.3 #7). Merging the *flows* is explicitly rejected.

### 6.6 Refresh Lock mechanism

Today's `inFlightRefreshes` Map is per-process (§ 0.3 #3). Options:

| Option | Trade-off |
|---|---|
| Keep in-process Map only | Free, and already there. Fails exactly when it matters: web + worker processes, or >1 replica, with a rotating-refresh provider |
| **Postgres advisory lock** (`pg_advisory_xact_lock` on a hash of the Connection key) | No new infrastructure — OM already requires Postgres; transaction-scoped locks release automatically if the holder dies (US-3.2); works across processes and replicas. Costs a connection held briefly during refresh, and a hashed 64-bit key (collisions are harmless here — a spurious wait, not a wrong result) |
| Redis lock (SETNX/Redlock) | Natural if `QUEUE_STRATEGY=async`/Redis is present. But Redis is optional in OM (`local` queue strategy exists), so this would make correctness conditional on deployment topology |
| DB row lock (`SELECT … FOR UPDATE` on the credentials row) | Also Postgres-only and simple. Slightly coarser (locks the row other readers may want) and entangles locking with the credentials service's own transaction handling |

**Recommendation: Postgres advisory lock (transaction-scoped), with the in-process Map kept as a cheap first-level short-circuit** so the common same-process case never touches the database. Keep the existing Map — it is not wrong, only insufficient.

**The audit settled the "does a helper exist?" question (§ 0.3 #12): the *pattern* has six in-repo precedents, the *helper* does not exist.** `pg_advisory_xact_lock` is inlined as raw SQL in `attachments`, `notifications`, `query_index`, `packages/documents`, and twice in enterprise `record_locks` — with no `withAdvisoryLock()` abstraction anywhere. So this toolkit writes the missing helper. Two notes on that: it belongs in `shared` (it is pure infrastructure over a Postgres connection, no domain dependency), and the six existing call sites become candidates to adopt it later — a small, real platform win beyond this spec's own needs, which is worth mentioning to maintainers as part of the Phase 2 pitch rather than hiding as an incidental.

### 6.7 Reauth classification

**Recommendation:** set `reauthRequired` **only** on a definitive credential failure — an OAuth2 `invalid_grant` (or a provider-documented equivalent) from the token endpoint. Network errors, timeouts, 5xx, and rate limits are transient: retry with backoff, leave the flag alone, and let the health probe be the eventual detector. The asymmetry is deliberate: a false "needs reauth" trains operators to ignore the banner, which is worse than a slightly slower true detection.

### 6.8 Migrating Gmail without breaking live Connections

**Recommendation:** treat PKCE as affecting **only new authorization flows**. A stored refresh token obtained without PKCE keeps refreshing normally — PKCE binds an authorization *code* to a token request and plays no part in the refresh grant. So the migration is: point Gmail's descriptor at the toolkit, keep the stored Token Set shape compatible, and prove with a test that an existing Token Set still refreshes after the switch. Redirect-URI stability is the one genuine hazard — if the callback route path changes, every tenant must re-register the URI in Google Cloud Console, which is a migration cost no amount of code care avoids. § 10 #6 makes that an explicit decision (keep the legacy per-hub callback path working for migrated providers, or accept re-registration).

#### Checklist
- [x] Every decision presented as options with trade-offs and a recommendation — none decided silently
- [x] Recommendations grounded in verified repo facts (§ 0.3) or named RFCs (§ 0.1), not preference
- [x] The cheap fallback (Option A) preserved rather than dismissed

---

## 7. Phasing & Rollout `PM`

### Phase 1: Protocol core + one provider end-to-end

**Goal:** a descriptor-driven, PKCE-protected connect/refresh/disconnect flow exists and is proven by exactly one provider.

**Why this order:** the descriptor + routes + client wrapper are mutually useless apart; and a toolkit with no consumer is unvalidated. Xero (already specced, § 8) is the natural first consumer because it needs Resource Selection, the hardest hook — proving the extension point rather than deferring it.

| Story | What ships | Commits |
|---|---|---|
| US-1.1, US-1.2 | Descriptor type (incl. the PKCE opt-out field with required justification), registry wiring, generator discovery, registration-time validation errors | 2 |
| US-1.1 | The `oauth` credential-field renderer — generic Connect/status/Reconnect control + i18n (removes the field type from `UNSUPPORTED_CREDENTIAL_FIELD_TYPES`) | 2 |
| US-2.1, US-2.2 | `openid-client` in core + `OAuth2Client` wrapper; generic initiate/callback routes; state cookie + PKCE; no-refresh-token warning | 4 |
| US-1.1 (hook) | Resource Selection hook + generic picker | 1 |
| US-5.1 | Disconnect: revoke where declared **and** actually clear the stored Token Set | 1 |
| US-0.1 | Fake authorization server + PKCE/`state`/`iss` round-trip tests | 1 |

**Total: 11 atomic commits**

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] A Connection has at most one Token Set at any time; a failed connect leaves none (no partial row).
- [x] Every authorization request carries a `code_challenge` unless the descriptor explicitly opted out; no code path emits an authorization request without either PKCE or a recorded opt-out.
- [x] A callback with an invalid/expired/foreign `state`, or a mismatched `iss`, results in **no token-endpoint call** — the failure precedes any exchange.
- [x] A Token Set is never emitted to a log, URL, telemetry attribute, or run parameter.

**Business criteria** `PM`:
- [x] An admin can connect one real provider end-to-end (Xero Demo Company or Gmail test account) and see the connected resource named.
- [x] Disconnect clears locally and revokes remotely where the descriptor declares it.
- [x] A developer can add a second provider with a descriptor and no protocol code.

**Value delivered:**
- **Business value:** the next OAuth2 integration is configuration, not protocol engineering — and it is PKCE-protected by default rather than by diligence.
- **ROI metric:** OAuth portion of a new provider ≤2 commits (baseline ~5); PKCE coverage of new flows 100% (baseline 0%).

**PM's challenges to the DDD criteria:** the PM pushed back on requiring the "never in telemetry attributes" criterion in Phase 1, since no telemetry emission is being added here — but it was kept, because the toolkit is where every future provider's token handling will be written, and establishing the invariant before there are five consumers is much cheaper than retrofitting it. All four accepted.

### Phase 2: Correctness under concurrency

**Goal:** a Connection cannot be broken by two processes refreshing it at once, and a broken Connection announces itself.

**Why this order:** Phase 1 is demonstrably useful but shares today's cross-process weakness; this phase is what makes the toolkit safe for unattended background workers — i.e. for `data_sync`, which is the main consumer.

| Story | What ships | Commits |
|---|---|---|
| US-3.2 | Reusable `withAdvisoryLock()` in `shared` — the helper § 0.3 #12 found missing despite six inlined precedents | 1 |
| US-3.1, US-3.2 | `getAccessToken` service; Refresh Lock wired in; re-read-under-lock; atomic rotated-Token-Set persistence | 2 |
| US-3.1 (failure taxonomy) | Transient vs. reauth classification, report-once semantics | 1 |
| US-4.1 | Generic OAuth health check wired to the existing 15-min probe | 1 |
| US-4.2 | Changed-`selectedResource` detection + warning | 1 |
| US-0.1 | Concurrency test: two workers, one Connection, rotating provider -> exactly one refresh | 1 |

**Total: 7 atomic commits**

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] At most one refresh per Connection is in flight cluster-wide; a concurrent caller observes the winner's Token Set rather than performing a second exchange.
- [x] A rotated refresh token is persisted in the same commit as its access token — no state exists where the access token is new and the refresh token is the superseded one.
- [x] A crashed lock holder releases the lock without operator action; no Connection becomes permanently unrefreshable.
- [x] `reauthRequired = true` only ever follows a definitive credential failure, never a transient one.

**Business criteria** `PM`:
- [x] A concurrency test (two workers, one Connection, rotating provider) shows exactly one refresh and zero flaps.
- [x] An admin sees a reauth banner within one health-probe interval of a definitive failure.
- [x] Reconnecting to a different remote resource produces an explicit warning naming both.

**PM's challenges to the DDD criteria:** the PM questioned whether same-commit persistence of access+refresh tokens was over-engineering versus "persist both, best effort" — and lost: a half-persisted rotation permanently bricks the Connection at the next refresh, which is precisely the incident class this phase exists to eliminate. Kept as written. All four accepted.

### Phase 3: Retire the duplication

**Goal:** one protocol path in the repo, Gmail included; the old utility locations remain importable but deprecated.

**Why this order:** migrating the one live provider is only safe once the toolkit is proven (Phases 1-2). Doing it last also means the migration's risk is carried by working, tested code rather than by a design.

| Story | What ships | Commits |
|---|---|---|
| Migration | Re-home the pure primitives into `shared/lib/oauth2/` with BC re-export shims at the `communication_channels` paths | 1 |
| Migration | `channel-gmail` onto the toolkit (gains PKCE, drops its bespoke Connect widget in favour of the generic renderer); prove existing Token Sets keep refreshing | 2 |

**Total: 3 atomic commits**

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] Existing Gmail Token Sets refresh successfully after the migration, proven by a test using a pre-migration credential blob.
- [x] No import path used by a shipped package breaks; deprecated paths re-export and are marked `@deprecated`.
- [x] Exactly one authorization-request builder and one token-exchange path remain reachable in `core`.

**Business criteria** `PM`:
- [x] Gmail connect/disconnect/refresh works unchanged from an admin's point of view, now with PKCE.
- [x] A tenant with a live Gmail channel notices nothing.

**PM's challenges to the DDD criteria:** the PM proposed dropping "exactly one builder remains reachable" as unmeasurable — it was reworded from an aspiration into a grep-able condition (no remaining provider-local authorize-URL construction in `packages/*`), then accepted.

### Phase 4 (optional): De-duplicate the state cookie with `enterprise/sso`

**Goal:** one state-cookie implementation instead of two.

**Why optional and last:** it touches the commercial package and delivers no user-visible value — pure debt reduction, correctly sequenced behind everything that does. Direction is `enterprise` importing `core` (allowed); the reverse remains banned.

| Story | What ships | Commits |
|---|---|---|
| — | `sso` adopts the toolkit's state-cookie helper; its own copy is removed or thinned | 1 |

**Total: 1 atomic commit** — genuinely small, and explicitly droppable.

**Domain criteria** `DDD`: SSO's existing key-derivation env vars keep working (its cookies must not be invalidated mid-session for live deployments).
**Business criteria** `PM`: no SSO user is logged out or blocked by the change.
**PM's challenges:** the PM asked whether this phase should exist at all, given zero user value; kept as optional-and-last precisely so it can be dropped without touching Phases 1-3's value story.

### Rollout Summary

```
Phase 1: Protocol core + first provider       11 commits   WF1, WF2, WF5, US-0.1
Phase 2: Correctness under concurrency         7 commits   WF3, WF4, US-0.1
Phase 3: Retire the duplication                3 commits   Migration
                                              ---------
                                              21 commits for production-ready (Phases 1-3)
Phase 4: State-cookie de-duplication (opt.)    1 commit    debt only, droppable
                                              ---------
                                              22 commits if Phase 4 is taken
```

#### Checklist
- [x] Phases ordered by priority x gap x blocker status; the live-provider migration deliberately last
- [x] Each phase delivers a complete, usable increment (P1 = a working provider, P2 = safe unattended operation, P3 = one code path)
- [x] Acceptance criteria per phase: DDD wrote domain criteria, PM challenged them — two challenges recorded as rejected-with-reason, one as reworded, one accepted
- [x] Business value + ROI metric per phase; no artificial phase (P4 is marked optional rather than padded into the total)

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs involved | Resolution |
|---|---|---|
| `.ai/specs/2026-09-26-oauth2-provider-toolkit-reuse.md` (on branch `xero-integration`) proposes the *narrow* fix — just detach `credential-refresh.ts` from `ChannelAdapter` | This spec | **This spec supersedes it**, and keeps it as the explicit fallback Option A in § 6.1. If maintainers decline the platform work here, that spec is still the right small step. Note it is not on `develop` yet |
| `.ai/specs/2026-09-26-app-spec-xero-integration.md` (on branch `xero-integration`) estimates ~5 commits for its own WF1 OAuth work and its Open Question #4 asks whether to generalize the refresh helper | This spec, the Xero App Spec | **Complementary, with a sequencing decision.** If Phase 1 here lands first, Xero's WF1 drops to ~2 commits and its Open Question #4 is answered by this spec. If Xero ships first, it becomes the migration target in Phase 3 alongside Gmail. Either order works; neither blocks. Xero's App Spec should be updated with whichever is chosen |
| `.ai/specs/2026-03-29-google-workspace-integration.md` (Draft) independently designs provider-owned OAuth routes, per-project OAuth tokens, and notes "Core does not yet render OAuth fields generically" as Design Decision 7 | This spec, the Google Workspace spec | **This spec directly resolves that spec's Design Decision 7.** Its per-project credential scoping is orthogonal (it uses the credentials service's own scoping, which the toolkit reuses unchanged). Google Workspace becomes a Phase-1-or-later consumer rather than a fourth hand-rolled flow |
| `enterprise/sso` owns OIDC login and its own state cookie | This spec, the SSO module | **No conflict, deliberate boundary** (§ 6.5): different use case, different lifecycle. Only the state-cookie primitive is (optionally, Phase 4) shared, in the permitted enterprise→core direction |

Entity ownership: this spec introduces **no** entity and takes ownership of none — `IntegrationCredentials`, `IntegrationState`, `IntegrationLog` all remain owned by `integrations`, which is also where the toolkit lives. The only new artifacts are in-code types (`OAuth2ProviderDescriptor`, `TokenSet`) and the JSON shape stored inside an existing encrypted column.

#### Checklist
- [x] All related specs listed with what each contributes
- [x] Identity model consistent across specs (internal-only everywhere)
- [x] Terminology consistent with § 1.3 — and the Xero spec's "Xero Organisation" is an instance of this spec's generic "Resource Selection"
- [x] No phantom entities — this spec adds none
- [x] Every conflict has a resolution, not "TBD"

---

## 9. Reference App Quality Gate `Architect`

N/A — this is a platform capability, not an example/reference app.

---

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|---|---|---|---|---|
| 1 | Verify § 0.1's standards summary against the current IETF OAuth WG state before implementation (OAuth 2.1 draft status, any RFC 9700 updates, current PKCE/`iss` guidance) | N/A — verification task | Medium — the design leans on these; a changed recommendation would change defaults | Architect (pre-implementation) | Open — trained-knowledge-sourced (web access unavailable this session), blocks safe implementation start, blocks nothing in this document |
| 2 | Approve adding `openid-client` as a **`core`** production dependency (it is already in `enterprise`) | (a) Approve — converge on one engine (recommended, § 6.2) (b) Hand-roll in core (c) Pick a lighter library | **High — gates Phase 1** | Maintainers (`AGENTS.md` Ask First: production dependencies) | Open — must be answered before Phase 1 starts |
| 3 | ~~Does a reusable advisory-lock helper already exist?~~ | — | — | Architect | **Answered by the audit: no.** The `pg_advisory_xact_lock` pattern has six inlined precedents but no shared helper exists (§ 0.3 #12). The toolkit writes one, in `shared`. Also corrected a first-draft assumption: `data_sync` has no advisory lock |
| 4 | Should the connect/callback write use the credentials row's existing optimistic locking, so two concurrent admins get a visible conflict instead of a silent overwrite? | (a) Yes — reuse `resolveUpdatedAt` (b) No — last write wins, accept orphaned tokens | Low (rare) but a confusing failure when it happens | PM + Architect | Open — leaning (a); § 5 impact matrix documents the exposure |
| 5 | ~~Is there already a fake/mock authorization server in the test setup?~~ | — | — | Architect | **Answered by the audit: no.** No `nock`/`msw`/HTTP double exists, and SSO's only protocol test `jest.mock`s `openid-client` wholesale, so **no test anywhere exercises a real OAuth round-trip** (§ 0.3 #14). US-0.1 introduces new test infrastructure; Phase 1 should budget for it explicitly rather than assuming fixtures exist |
| 6 | Callback URL strategy for migrated providers: keep the legacy per-hub path working (`/api/communication_channels/oauth/[provider]/callback`) or move everyone to `/api/integrations/oauth/[provider]/callback` and require tenants to re-register redirect URIs in each provider's console? | (a) Keep legacy paths as aliases for migrated providers — no tenant action (recommended) (b) Single canonical path, tenants re-register | **High for Phase 3** — (b) is a breaking operational change for every live tenant | PM + Architect | Open — leaning (a); § 6.8 explains why this is the one hazard code care cannot remove |
| 7 | Should `enterprise/sso` ever share more than the state cookie with this toolkit? | (a) No — permanent boundary (recommended, § 6.5) (b) Revisit if a third OAuth-login use case appears | Low | Architect | Open — recommended default (a) |
| 8 | What happens to `sync-akeneo`'s ROPC (`grant_type=password`) flow, which OAuth 2.1 removes and this toolkit deliberately won't host (§ 0.3 #10, § 1.2)? | (a) Leave it alone — it works, Akeneo's API supports it, and touching it is unrelated risk (b) Migrate Akeneo to authorization-code via this toolkit, if Akeneo supports it for the tenant's deployment type (c) Keep ROPC but at least move its in-closure token state into encrypted credential storage | Medium — it is the weakest of the three flows (credentials exchanged directly, token state in a module variable) but also the least exposed (no redirect, no browser) | Architect + whoever owns `sync-akeneo` | Open — leaning (a) for this spec's scope with (c) as a cheap improvement; explicitly **not** silently absorbed into the toolkit |
| 9 | Should the `redirect_uri` request-origin fallback (`NEXT_PUBLIC_APP_URL \|\| APP_URL \|\| resolveRequestOrigin(req)`) be tightened for OAuth flows specifically, given RFC 9700 requires exact redirect-URI matching (§ 0.3 #15)? | (a) Require an explicitly configured base URL for OAuth initiate/callback and fail loudly when absent (b) Keep the request-origin fallback as-is for developer convenience | Medium — a proxy/Host-header mismatch silently changes the computed `redirect_uri` and breaks consent with a confusing provider-side error | Architect | Open — leaning (a) for OAuth paths only, keeping the fallback everywhere else |

#### Checklist
- [x] Every question has options, impact, owner, status
- [x] The two gating questions (#2 dependency approval, #6 callback strategy) are flagged as blocking their phase, not buried
- [x] Decided questions live in § 6 with rationale, not duplicated here

---

## Production Readiness `PM`

| Workflow | Deployable | Blocker | What the client would say |
|---|---|---|---|
| WF1 Developer adds provider | After Phase 1 | Open Question #2 (dependency approval) | "Adding the next integration didn't mean re-reading the OAuth spec." |
| WF2 Admin connects | After Phase 1 | None | "Connecting Xero felt exactly like connecting Gmail." |
| WF3 Transparent refresh | After Phase 2 | None (Phase 1 first) | "It stopped asking me to reconnect every few days." |
| WF4 Reauth surfacing | After Phase 2 | None | "It told me the connection died instead of just going quiet." |
| WF5 Disconnect + revoke | After Phase 1 | None | "When I disconnected, it was actually gone from my Google account too." |
| Migration (Gmail) | After Phase 3 | Open Question #6 (callback URL strategy) | "I didn't notice anything — which is what I wanted." |

**Honest note on WF3 before Phase 2:** shipping Phase 1 alone leaves the cross-process refresh race exactly as it is today — no worse, but not fixed. A deployment that runs workers separately from web (the normal production topology) should not be told the concurrency problem is solved until Phase 2 lands.

#### Checklist
- [x] Each workflow assessed binary with its specific blocker
- [x] "What would the client say" phrased as the complaint/praise, not the technical gap
- [x] No workflow stops midway; the Phase-1-without-Phase-2 caveat is stated rather than glossed

---

## Changelog

### 2026-09-26
- Initial draft, on a fresh branch off `develop`. Written with `om-app-spec-writing` after the Xero App Spec surfaced OAuth reuse as a recurring platform question rather than a Xero-specific one.
- **Standards research** (§ 0.1) from trained knowledge — live web access was denied in this environment for the whole session, so § 10 #1 carries a pre-implementation verification task. **Prior-art survey** (§ 0.2) covers Nango, Auth.js, arctic, `openid-client`, Airbyte and Passport with explicit adopt/reject calls.
- **Repository findings** (§ 0.3) read directly from code, and they reframed the proposal: Gmail's OAuth flow has **no PKCE** (`channel-gmail/.../lib/oauth.ts:64-88`); refresh coalescing is an in-process `Map` (`credential-refresh.ts:60`) that cannot serialize OM's separate web and worker processes; the `oauth` credential-field type is declared but refused by the admin UI; the state-cookie pattern already exists **twice** (core + enterprise, forced by the import ban); and decisively, **`packages/enterprise` already depends on `openid-client` ^6.8.4 and uses it correctly with PKCE and discovery** (`sso/lib/oidc-provider.ts:36,39,70,147,153`) — the professional approach is already in this repo, in the commercial package, for a different use case, while core's OSS integration flow reinvented a weaker version.
- Eight decisions presented as options with recommendations (§ 6): build vs. narrow, adopt `openid-client` vs. hand-roll, where it lives, PKCE default, the SSO boundary, the Refresh Lock mechanism, reauth classification, and the Gmail migration. The narrow proposal from the `xero-integration` branch is preserved as the explicit fallback rather than discarded.
- **Revised the same day against a dedicated repo audit** (dispatched as a fresh-context subagent; findings recorded as § 0.3 #10-15). It corrected three assumptions this document was drafted on and added three findings: (1) a **third** client-side OAuth implementation exists — `sync-akeneo` uses ROPC (`grant_type=password`), a grant OAuth 2.1 removes — now explicitly out of scope with its own open question (§ 10 #8) rather than silently absorbed; (2) `data_sync` does **not** use an advisory lock as first drafted — the pattern has six inlined precedents elsewhere and **no shared helper exists**, so the toolkit writes one (§ 10 #3 answered, § 6.6); (3) **no mock authorization server and no real-protocol round-trip test exist anywhere**, and SSO's only protocol test mocks `openid-client` wholesale — so test infrastructure is genuinely new work, scored as +2 commits that the first draft had assumed free (§ 10 #5 answered, § 4); (4) disconnect is **worse** than "no revocation": it nulls a pointer and leaves the `integration_credentials` row intact, so a valid encrypted refresh token survives a disconnect (§ 0.3 #13) — WF5 now fixes two things; (5) the cross-process refresh race is **latent, not active**, because Google doesn't rotate refresh tokens — WF3's ROI restated honestly as preventing Xero's guaranteed problem rather than fixing a current Gmail one; (6) redirect URIs fall back to the request origin when `APP_URL`/`NEXT_PUBLIC_APP_URL` are unset, which conflicts with RFC 9700's exact-match requirement (new § 10 #9). The audit also let § 6.3 improve on the first draft: pure primitives belong in `packages/shared` (zero domain deps, and it makes the optional SSO de-duplication trivial), with only the OM-integrated parts in `integrations`. Totals moved 19 -> 21 commits as a result.
- Pending: the mandatory challenger gate and architect checkpoint for this document.
