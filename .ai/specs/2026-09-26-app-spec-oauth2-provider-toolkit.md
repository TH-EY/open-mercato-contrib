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
12. **Advisory locks are used at least seven times over, and a small generic helper already exists** — in an unexpected package. Raw inlined SQL at `attachments/lib/quota-service.ts:146` (`pg_advisory_xact_lock(hashtextextended(...))`), `notifications/lib/notificationService.ts:199`, `query_index/lib/coverage.ts:154`, `packages/documents/.../lib/folderHierarchySerialization.ts:3`, `enterprise/.../record_locks/lib/recordLockService.ts:1558,1834`, and `enterprise/sso/services/ssoConfigService.ts`. **Corrected by the architect checkpoint:** a reusable wrapper *does* exist at `packages/tillio/src/modules/tillio/lib/locking.ts:16` — `createTillioLock(em, key)`, roughly 30 lines of `em.transactional` + `pg_advisory_xact_lock`. So promoting it to `shared` is a **copy, not a design**, and § 4 scores it accordingly (1 commit, not 2). `packages/cache` still has no lock primitive (no `NX`/lease API), and `record_locks` remains a user-facing pessimistic UI lock, enterprise-only and unusable from core. **Also corrected from this document's first draft:** `data_sync` does *not* use an advisory lock — "advisory" in its `lib/adapter.ts:54,84` is plain English ("This is not advisory").
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
| Connection | One tenant's (optionally one user's) authorized link to one Provider — concretely, **one `IntegrationCredentials` row** holding a Token Set. **Deliberately not called "account" or "channel"**: `communication_channels` already uses `channelId` for its own per-mailbox concept, and a Connection is the broader notion. **A Connection is NOT `IntegrationCredentials` + `IntegrationState`** — the first draft said that and it was wrong: `IntegrationState` has no `user_id`, so it cannot represent per-user Connections (§ 6.9). The Connection is the credentials row; per-Connection lifecycle state is § 6.9's decision. | `IntegrationCredentials` | N/A |
| Connection Key | The one tuple that identifies a Connection everywhere: **`(integrationId, organizationId, tenantId, userId ?? '∅')`**. Used for the credential lookup, the descriptor lookup, the route parameter, and the advisory-lock hash — one definition, no per-site variation. **Note `providerKey` is NOT this key**: it is optional and non-unique on `IntegrationDefinition`, and bundle siblings can share one. `integrationId` is the registry key. | This toolkit | N/A |
| Token Set | The credential payload of a Connection: access token, refresh token, expiry, granted scopes, token type, and refresh generation (§ 1.4). **Does not include the selected Resource** — that outlives token clearing and is stored beside it (§ 1.4, Connection Binding). | Token endpoint response, zod-parsed at the boundary | N/A |
| Connection Binding | The non-secret facts about *what* a Connection points at — the selected Resource (Xero Organisation, Slack workspace) and the account label shown in the UI. Stored beside the Token Set but **not cleared with it**, because US-4.2 needs the previous Resource to detect a changed one after a reconnect. | Resource Selection | N/A |
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
| `refreshRetryGraceMinutes` | integer | no | no | How long after a failed refresh the **old** refresh token may still be retried, per the provider's documentation. Default `0` (a persist failure is immediately definitive). Xero sets `30`. See § 1.4 invariant 5 |
| `requiredFeature` | text (ACL feature id) | no | no | Which ACL feature gates connect/disconnect for this provider. Defaults `integrations.credentials.manage`; Gmail sets `communication_channels.connect_user_channel` so its migration does not change an ACL contract surface (§ 1.4 Access control) |
| `perUserScoped` | boolean | no | no | Whether Connections for this provider are per-user (`scope.userId` set) or tenant-wide. Drives the Connection Key and, with § 6.9, where reauth state lives |

**`TokenSet`** — the shape stored inside the existing encrypted `IntegrationCredentials.credentials` JSON (additive to whatever else a provider stores; no schema change):

| Field | Type | Required | Notes |
|---|---|---|---|
| `accessToken` | text | yes | Encrypted at rest by the existing envelope |
| `refreshToken` | text | no | Absent for providers that don't issue one |
| `expiresAt` | datetime (ISO) | no | Absent when the AS omits `expires_in`; then refresh is `force`-only |
| `grantedScopes` | text[] | no | What the user actually consented to (may differ from requested) |
| `tokenType` | text | no | Practically always `Bearer` |
| `refreshGeneration` | integer | **yes** | Increments on each successful rotation. **Load-bearing, not diagnostic**: it is half of the compare-and-set that makes persistence safe (invariant 4 below) |
| `obtainedAt` | datetime (ISO) | yes | For diagnostics and for age-based reauth prediction |

> **`selectedResource` deliberately does NOT live here** (moved out after DDD review). It belongs to the **Connection Binding** (§ 1.3), stored beside the Token Set and *not* cleared with it — because US-4.2 must compare the previous Resource against the new one *after* a disconnect/reconnect cycle has already cleared the tokens. Keeping it inside the Token Set would delete the very fact the warning depends on.

**Domain invariants.** Six of the eight below were added or corrected after the DDD challenger gate found the first draft's set both incomplete and, in two cases, factually wrong about what the platform enforces:

1. **A Connection has at most one Token Set — and this spec must make that true, rather than inheriting it.** The first draft credited the existing unique index; that was wrong. `integration_credentials_user_lookup_idx` is **partial — `WHERE user_id IS NOT NULL AND deleted_at IS NULL`** — so **tenant-wide** Connections (the primary Xero/HubSpot shape) have *no* uniqueness constraint at all, and a duplicate pair would be resolved by a nondeterministic `findOne`. Phase 1 therefore adds the missing sibling partial index (`WHERE user_id IS NULL AND deleted_at IS NULL`) as migration work (§ 4).
2. **A refresh for one Connection is serialized cluster-wide** — at most one in-flight refresh per Connection Key, regardless of process count.
3. **A refresh writes back to the exact row it read from, identified by row id, and never creates a row.** This is the invariant the first draft was missing, and without it the Refresh Lock is provably ineffective: `credentialsService.getRaw` **falls back** to the `user_id IS NULL` row when a user-scoped row is absent, while `save` writes **strictly** to the user-scoped filter. So a user-scoped `getAccessToken` would read the *tenant* Token Set, rotate it, and write a *new user-scoped row* — leaving two Connections sharing one rotated refresh-token family under **two different lock keys**. The identical trap exists via the bundle credential fallthrough (`resolve()` may read the bundle's row while `save()` writes the child's). Consequence for implementation: the credentials service must expose row identity on read (§ 4 scores this), and WF1 edge 5's "honour the existing bundle fallthrough" applies to *reads for API calls*, never to refresh write-back.
4. **Persistence of a rotated Token Set is a compare-and-set on (row id, `refreshGeneration`)** — not a plain `save`. `save()` filters `deletedAt: null`, finds nothing when a row was cleared, and **creates a new row**, which would resurrect a Token Set a disconnect had just removed. "Write-after-delete must lose" is therefore unachievable through `save()` alone, which is why the first draft's claim that the Refresh Lock covered it was wrong.
5. **The window that matters is AS-commit vs DB-commit, not one DB commit.** Both tokens live in one JSON column, so "persisted in the same commit" is nearly vacuous; the real hazard is the AS having invalidated the old refresh token while the local persist then fails — which bricks the Connection. So: persist inside the lock's transaction, and treat **a persist failure as definitive once the provider's retry grace window has closed** — at which point it must set reauth rather than invite a retry against an already-invalidated token.

   **The grace window is a descriptor field, not a constant — and the first consumer proved why.** The original wording said a persist failure is *always* definitive, reasoning that the old refresh token is already dead. That is too strict for at least one real provider: **Xero documents a 30-minute window in which the old refresh token may still be retried** — *"If you don't receive a response from a token refresh you can retry using your existing refresh token for up to 30 minutes"* (verified in the Xero App Spec, § 0.1). Hard-coding either behaviour would be wrong for half the providers, so the descriptor carries **`refreshRetryGraceMinutes`** (default `0`, i.e. the strict original behaviour). Inside the window the toolkit retries with the stored token; outside it, the failure is definitive. Discovering this from a consumer spec before implementation is exactly what naming a first consumer was supposed to achieve.
6. **A Token Set is only ever constructed by parsing the AS response with a zod schema at the boundary.** An unparseable or implausible response (absent `access_token`, negative/absurd `expires_in`, oversized fields, `token_type` other than `Bearer`, or a rotating provider omitting `refresh_token` on a refresh) is a definitive failure that stores **nothing partial**. This is the anti-corruption layer; without it a merely sloppy provider can corrupt a Connection.
7. **`reauthRequired = true` ⟺ the stored refresh token is *believed* permanently unusable** — "believed" deliberately, since a health probe can only ever observe a failed call. Set only on a definitive `invalid_grant`-class failure or a failed persist (invariant 5), never on a transient network/5xx error (§ 6.7).
8. **A Token Set is never written to a log, a URL, a run parameter, or a telemetry attribute.** (`IntegrationLog` already strips secret fields; run parameters are documented as operator-visible clear text, so tokens must never travel that path.)
9. **PKCE is used unless the descriptor explicitly opts out with a recorded reason**, and never downgraded at runtime (§ 6.4).

**Domain events.** The first draft had the toolkit writing state and pausing other modules' schedules directly — hidden coupling the DDD gate correctly rejected. The toolkit instead declares four events and lets consumers subscribe:

| Event | Emitted when | Who cares |
|---|---|---|
| `integrations.connection.connected` | A Token Set is first stored for a Connection | Providers that want to kick off an initial sync |
| `integrations.connection.reauth_required` | A definitive failure flips the reauth state | Notifications; provider-side pausing |
| `integrations.connection.resource_changed` | A reconnect selected a different Resource (§ WF4) | **Essential** — each provider owns its external-id mappings and must react; a UI confirmation cannot reach that data |
| `integrations.connection.disconnected` | A Connection's Token Set is cleared | `data_sync` schedule pausing, channel-status updates — as subscribers, not as toolkit responsibilities |

**Access control.** Connect/disconnect on a tenant-wide Connection is `integrations.credentials.manage`; viewing state is `integrations.view`. **Per-user Connections are the exception the first draft got wrong:** today's per-user connect is gated on `communication_channels.connect_user_channel` (`initiate/route.ts:23`), which a generic toolkit must not depend on — and silently changing which feature gates Gmail's connect flow would itself be an ACL contract change (`BACKWARD_COMPATIBILITY.md` treats ACL features as a contract surface). So the descriptor carries a **`requiredFeature`** field, defaulting to `integrations.credentials.manage`, which Gmail sets to its existing feature to migrate without an ACL break. "No new ACL features" holds; "no ACL coupling" required a descriptor field to be true.

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
| OM Staff user (per-user Connections) | the descriptor's `requiredFeature` (§ 1.4) — e.g. Gmail keeps `communication_channels.connect_user_channel` | internal | own user within a tenant | Their own Connection's status | Connects/disconnects **their own** mailbox-style Connection (existing per-user credential scoping) |
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
- Ends when: a valid access token is returned, or a typed failure is raised — one of **transient**, **reauth-required**, or **re-consent-required** (§ 6.7).
- NOT this workflow: the provider's own rate limiting/retry of its business calls (that stays in the provider adapter, per `data_sync`'s "no provider specifics in the generic module" rule).

**Edge cases:**
1. **Two processes need a refresh simultaneously** (the whole point): one wins the lock and rotates; the other waits, re-reads, and uses the winner's new token — it must **not** exchange the now-invalidated refresh token.
2. **The waiter re-reads and finds the winner set `reauthRequired` instead of a new token** — the winner's refresh failed definitively. The waiter must return the *reauth* failure, not block again and not retry the dead refresh token. (The first draft said the waiter "uses the winner's token", which in this branch does not exist.)
3. **Lock acquisition itself must be bounded.** A plain `pg_advisory_xact_lock` blocks indefinitely, which contradicts US-3.1's "lock acquisition times out -> typed transient error"; so the implementation uses `pg_try_advisory_xact_lock` with bounded retry (or sets `lock_timeout`). Flagged because the first draft named the blocking variant while promising a timeout.
4. **The lock is held across a third-party HTTP round trip**, and an advisory lock holds a pooled DB connection for that whole time — which interacts with the connection-budget invariant in `packages/shared/AGENTS.md`. The provider HTTP call therefore carries an explicit, short timeout (the existing token-POST helper already enforces one, `OM_OAUTH_TOKEN_TIMEOUT_MS`, default 10s), so a hung AS cannot pin a connection indefinitely.
5. Lock holder crashes mid-refresh -> a transaction-scoped advisory lock releases on connection loss; the next caller proceeds cleanly with no operator action.
6. Refresh returns a new refresh token (rotation) -> persisted by compare-and-set on (row id, `refreshGeneration`), inside the lock's transaction (§ 1.4 invariants 3-5). **A persist failure after the AS rotated is definitive, not transient** — the old refresh token is already dead, so retrying it cannot succeed.
7. Refresh fails transiently (network, 5xx, timeout) -> retried with backoff; **`reauthRequired` stays false** (§ 6.7).
8. Refresh fails definitively (`invalid_grant`, or an unparseable token response per § 1.4 invariant 6) -> `reauthRequired = true`, event emitted, error reported once (not once per call), WF4 takes over.
9. Token has no `expiresAt` -> proactive refresh is impossible; a 401 from the provider triggers one forced refresh-and-retry, and a second 401 is a real failure rather than an infinite loop.
10. **The AS returns narrower scopes than requested** -> stored in `grantedScopes` and surfaced, because a Connection that technically works but cannot perform half its provider's operations is worse than a visible failure (§ 5, US-2.3).

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
1. Revocation endpoint returns an error or times out -> **local Token Set is still cleared**; the failure is logged, not fatal. Refusing to disconnect locally because a remote call failed would trap the tenant.
2. Descriptor declares no `revocationUrl` -> local clear only, and the UI says so honestly rather than implying remote revocation happened.
3. Disconnect races an in-flight refresh -> the Refresh Lock serializes them, **and** the compare-and-set of § 1.4 invariant 4 is what actually makes the post-clear write lose. (The Lock alone cannot: `save()` would happily create a fresh row.)
4. Per-user Connection disconnected by an admin rather than its owner -> permitted only with the descriptor's `requiredFeature`, and scoped to the right `userId` row so it doesn't clear the tenant-wide row instead (§ 1.4 invariant 3's read-fallback trap applies here too).
5. **Disconnect immediately followed by reconnect** (an admin fixing something) -> the Connection Binding's previous Resource must survive the clear so WF4's changed-Resource warning still works; only the Token Set is cleared (§ 1.3, § 6.10).

> **"Clear the Token Set" needs a definition, not a verb** — the DDD gate flagged this and § 6.10 decides it. The two candidate meanings differ materially: soft-delete the whole `integration_credentials` row (which also discards the admin's `clientId`/`clientSecret`, forcing re-entry on reconnect) versus strip only the OAuth keys and keep the app credentials. Note also that `credentialsService` currently exposes **no delete or clear method at all** (`getRaw`/`getRowUpdatedAt`/`resolveUpdatedAt`/`resolve`/`save`/`saveField`/`getSchema`), so "the service is there" from the first draft overstated it — either `save` with a stripped blob, or a new method, is required work.

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
| Implement the `oauth` credential-field renderer (removing it from `UNSUPPORTED_CREDENTIAL_FIELD_TYPES`) | **more already exists than the first draft credited**: `buildCredentialFields` (`page.tsx:292-358`) already maps declarative fields to `CrudField`s and already has a `type:'custom'` escape hatch; the Connect control is already generic in `communication_channels/lib/use-connect-channel.ts:16` (provider-key-parameterized), with Gmail's widget only ~28 lines on top; and `reauthRequired`/`hasCredentials`/`credentialsUpdatedAt` are already on the detail payload (`page.tsx:110-124`) | 1 | platform | **1** | **Rescored 2 -> 1 by the architect checkpoint.** The genuinely new part is narrow: keeping an `oauth` field out of the CrudForm value model, since `isEditableCredentialField` (`page.tsx:74`) feeds both `credentialFormFields` and `credentialSchema` (`:839-937`) |

#### WF2: Admin connects — Total: 5 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Add `openid-client` to `core` + a thin `OAuth2Client` wrapper (discovery or manual metadata, PKCE, `iss`, client-auth methods) | in-repo precedent in `enterprise` (§ 0.3 #6), not yet in `core` | 3 | platform | 2 | Dependency addition needs the "Ask First" nod (§ 6.2, § 10 #2) |
| Generic `initiate` / `callback` / `disconnect` routes under `/api/integrations/oauth/[provider]/*` | none generic | 3 | platform | 2 | Includes state-cookie issue/verify and the callback error taxonomy |
| Resource Selection **hook only** — no generic picker in this spec | DI-registered provider services (`integrations/AGENTS.md:16`) + `InjectionSpot` already in the credentials tab (`page.tsx:9`) | 1 | platform | 1 | **Rescored by the architect checkpoint**: the platform pattern for this already exists, so Xero's Organisation picker ships as a provider-injected widget. A descriptor-driven *generic* picker before a second consumer would be speculative — deferred until one exists |
| Missing partial unique index on tenant-wide credentials (`WHERE user_id IS NULL AND deleted_at IS NULL`) | **nothing — the existing index is partial and covers only `user_id IS NOT NULL`** (§ 1.4 invariant 1) | 2 | platform | 1 | Added after the DDD gate disproved the first draft's uniqueness claim. Migration + snapshot; must handle pre-existing duplicates before the index can be created |

#### WF3: Transparent token refresh — Total: 5 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| `getAccessToken(connection)` service: validity check, re-read-under-lock, rotate, persist | `credential-refresh.ts` logic exists but is `ChannelAdapter`-typed (§ 0.3 #4) | 2 | platform | 1 | Largely a re-home + detach of existing, working logic |
| **Row-identity reads + compare-and-set persistence** in `credentialsService` | **none, and today's shape is actively unsafe**: `getRaw` falls back to the tenant row while `save` writes strictly to the user-scoped filter, and `save` *creates* a row when none matches (§ 1.4 invariants 3-4) | 3 | platform | 2 | Added after the DDD gate. Without it the Refresh Lock is decorative — two Connections can share one rotated token family under two different lock keys — and a post-disconnect write resurrects a cleared Token Set |
| **Cross-process Refresh Lock** | pattern has 7 in-repo precedents **and a 30-line generic helper already exists** at `packages/tillio/.../lib/locking.ts:16` (§ 0.3 #12); in-process `Map` only today (§ 0.3 #3) | 2 | platform | **1** | **Rescored 2 -> 1 by the architect checkpoint**, which found the helper the first draft said did not exist. Promoting `createTillioLock` to `shared` is a copy plus the `pg_try_advisory_xact_lock`/`lock_timeout` change of § 6.6, not a design |
| Failure taxonomy — **three classes: transient / reauth / re-consent** — + single-report semantics + the token-response zod boundary | — | 2 | platform | 1 | Small, but it is what keeps `reauthRequired` trustworthy; also carries § 1.4 invariant 6's anti-corruption parse and § 6.7's `WWW-Authenticate` branch |

#### WF4: Reauth surfacing — Total: 2 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Generic OAuth health check registered for any OAuth provider | `integrationHealthService` + 15-min probe | 1 | platform | 1 | Reuses the probe wholesale — **but which Connection it probes is undefined for per-user providers until § 6.9 is decided** |
| Changed-Resource detection + warning, driven by `integrations.connection.resource_changed` | — | 1 | platform | 1 | Also closes an open question in the Xero App Spec. Now event-based (§ 1.4) rather than a UI-only warning, because each provider owns its own external-id mappings |
| **Per-Connection reauth state** (§ 6.9) | **none — `IntegrationState` has no `user_id`** (`entities.ts:97-140`), so N per-user credential rows collapse onto one state row | 3 | platform | 2 | Added after the DDD gate. Sized for option (a) of § 6.9; option (b) drops it to 0 by removing Gmail from Phase 3 |

#### WF5: Disconnect with revocation — Total: 1 atomic commit

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Descriptor-driven RFC 7009 revocation, non-fatal on failure | none today | 1 | platform | 1 | One POST + error swallowing, plus honest UI copy when unsupported |

#### Test infrastructure (US-0.1 — not a workflow, but unscored in the first draft) — Total: 2 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| A fake authorization server for tests (PKCE round-trip, `state`/`iss` rejection, rotation, concurrent-refresh serialization, `invalid_grant` -> reauth, revocation) | **none — no mock AS, no HTTP double, and no test anywhere exercises a real OAuth round-trip** (§ 0.3 #14) | 3 | platform | 2 | Added after the audit corrected the assumption that fixtures existed. Without this, the Phase 2 concurrency guarantee is unprovable, which would make it a claim rather than a criterion |
| **Jest transform allowlist for `openid-client`** | **blocker found by the architect checkpoint**: `packages/core/jest.config.cjs` `transformIgnorePatterns` does not whitelist `openid-client`, which is ESM-only (`"type":"module"`, no CJS export), and the transformer emits CJS — so any core test transitively importing it fails unless `jest.mock`'d, which is exactly what `enterprise/.../__tests__/oidc-provider.test.ts:1` does and exactly what US-0.1's "real protocol round-trip" criterion forbids | 1 | platform | 1 | The fake AS must therefore be a **fetch-level** double, not a mocked `openid-client`. No *build* blocker: core is ESM and builds unbundled (`format='esm'`, `bundle=false`), and `enterprise` already ships it as a prod dependency |

#### Migration (not a workflow — a prerequisite for calling this done) — Total: 3 atomic commits

| Step | Gap | Scope | Commits | Notes |
|---|---|---|---|---|
| Re-home `oauth-state.ts`/`oauth-token.ts` into the toolkit with BC re-export shims at the old paths | 2 | platform | 1 | `channel-gmail` imports the old paths today (§ 0.3 #5); shims per `BACKWARD_COMPATIBILITY.md`. **Not a pure move**: `oauth-state.ts:28-33` bakes `communication_channels` into the HKDF info string and the cookie name — see § 6.12 |
| Migrate `channel-gmail` onto the toolkit (gaining PKCE) without invalidating live Connections | 3 | platform | 2 | Existing Token Sets must keep working; see § 6.8. Also changes which ACL feature gates its connect flow unless the descriptor's `requiredFeature` is used (§ 1.4) |

#### Domain events (added after the DDD gate) — Total: 1 atomic commit

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Declare the four `integrations.connection.*` events via `createModuleEvents`; move `data_sync` schedule pausing and channel-status updates out of the toolkit and into subscribers | `createModuleEvents` + subscriber conventions are mature (`core` -> Events) | 1 | platform | 1 | Cheap because the platform pattern is mature; **necessary** because without it the generic toolkit reaches into `data_sync` and `communication_channels` directly, which is the coupling § 6.3 exists to avoid |

### Gap Summary

| Workflow | Business Priority | Atomic Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|---|---|---|---|---|---|
| WF1 Developer adds provider | High | 3 | No | 3 | Yes — the developer-velocity ROI is this workflow |
| WF2 Admin connects | High | 5 | No | 5 | Yes — nothing works without it |
| WF3 Transparent refresh | **High** | 5 | No | 5 | Yes — this is the "stays connected" ROI and the correctness fix |
| WF4 Reauth surfacing | Medium | 4 | Partially — `reauthRequired` can be set by hand by a provider today | 4 | No, but silent staleness without it |
| WF5 Disconnect + revoke + actually clear tokens | Medium-**High** (security) | 1 | No — today's disconnect leaves a valid refresh token at rest (§ 0.3 #13) | 1 | No for function, **yes for the security claim** |
| Domain events | Medium | 1 | No | 1 | No — but without it the toolkit is coupled to two consumer modules |
| Test infrastructure (fake AS + Jest allowlist) | High | 3 | No | 3 | Yes — Phase 2's concurrency criterion is unprovable without it |
| Migration (Gmail + re-home) | High | 3 | No | 3 | Yes — without it the duplication this spec exists to remove survives |

**Total: 25 atomic commits.** The trajectory across three drafts is worth stating plainly, because it is the argument for having run the gates at all: **19 (first draft) -> 21 (self-audit found no test infrastructure) -> 25 (two independent review gates)**. The two gates moved the number in both directions — the architect checkpoint *removed* 3 commits by finding work that already existed (a lock helper in `packages/tillio`, a generic Connect hook and `type:'custom'` field escape hatch in the credentials UI, `getAppBaseUrl`/`toAbsoluteUrl` in `shared`), while the DDD gate *added* 6 for correctness work the first draft had assumed away (a missing unique index, row-identity reads, compare-and-set persistence, per-Connection reauth state, domain events, a Jest transform allowlist). A review that only ever adds is not reviewing.

Every gap is `platform`-scoped: this capability *is* a platform contribution, not an app feature — so it needs maintainer buy-in before Phase 1, not merely a code review (§ 10 #2).

#### Checklist
- [x] Every workflow step scored in atomic commits
- [x] Scope column honest: all `platform`, flagged as needing upstream buy-in
- [x] Migration counted as real work rather than assumed free
- [x] Architect checkpoint — **run**; corrections folded in above and in § 0.3 #12, § 6.3, § 6.6 (3 commits removed, 1 test blocker added)
- [x] DDD challenger gate — **run**; corrections folded into § 1.3, § 1.4, WF3, WF5 and the new § 6.9-6.12 (6 commits added)

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
| `data_sync` schedules | as-is | **pause via an `integrations.connection.disconnected` subscriber** | The toolkit does not touch `data_sync` — it emits, `data_sync` reacts (§ 6.11) |
| `createModuleEvents` | use | the four `integrations.connection.*` events | § 1.4; the mechanism by which the toolkit stays decoupled from its consumers |

**How provider-specific behaviour reaches a generic toolkit.** `integrations/AGENTS.md:29` forbids the `integrations` module from importing provider modules, so every provider-specific step — Resource Selection, post-connect mapping reconciliation, provider-shaped pickers — arrives through **DI-registered provider services and registry hooks** (`integrations/AGENTS.md:16`), never a direct import. The descriptor is data; the hooks are resolved from the container by `integrationId`. This is stated explicitly because it is the only way the two AGENTS.md rules (`:16` and `:29`) can both hold, and the architect checkpoint asked for it in writing.

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

**US-2.3** As an OM Admin, when the provider grants fewer scopes than we asked for — or when a call later fails because a scope is missing — I am told plainly, rather than discovering it as a broken feature weeks later.
*Extended after the first consumer's research: the connect-time check below is the **detection** half; § 6.7's `re-consent` failure class is the **runtime** half, for a scope gap that only surfaces when a particular endpoint is first called. Both matter, because a provider may grant everything asked for while the descriptor itself asked for too little.*
Success: `grantedScopes` is compared against the descriptor's requested scopes; a narrower grant stores the Connection but surfaces a named warning listing what is missing.
**Happy path:** all requested scopes granted -> no warning.
**Alternate paths:** the provider grants a superset (some do) -> no warning; extra scopes are recorded, not treated as an error.
**Failure paths:** the AS omits `scope` from its response entirely -> treated as "assume requested", recorded as unverified rather than silently claimed as complete, because guessing in the optimistic direction is what produces the weeks-later surprise this story exists to prevent.
*Added after the DDD gate observed that the first draft stored `grantedScopes` but had no story that ever read it — a Connection that technically works while half its operations 403 is worse than a visible failure.*

### Default User Stories

**US-0.1** As someone evaluating or testing this toolkit, I can exercise a full connect/refresh/reauth cycle without a real third-party account, so that OAuth behavior is testable in CI.
Success: a fake authorization server (or recorded fixtures) lets tests cover: PKCE round-trip, `state` rejection, `iss` rejection, rotation, concurrent-refresh serialization, `invalid_grant` -> reauth, and revocation-on-disconnect. **The double must operate at the `fetch` level, not by mocking `openid-client`** — the architect checkpoint found `packages/core/jest.config.cjs` does not whitelist `openid-client` in `transformIgnorePatterns`, so a core test importing it fails unless mocked, and a mocked protocol engine cannot satisfy "real protocol round-trip" (§ 4, § 10 #5).

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
| **US-2.2 (a Connection with no refresh token)** | a Token Set exists with `refreshToken` absent | US-3.1, US-4.1 | `getAccessToken` cannot refresh it, so the Connection dies silently at first expiry and the reauth flag never explains why | Warn at connect time (US-2.2); classify "expired with no refresh token" as a **definitive** failure so it reaches the reauth banner rather than looping as transient |
| **US-3.2 (a lock holder dies mid-refresh)** | advisory lock released by connection loss; Token Set may be pre- or post-rotation | US-3.1 in every other process | If the AS rotated but the local persist never happened, every later refresh presents a dead token — an unrecoverable loop unless classified | § 1.4 invariant 5: a persist failure after remote rotation is definitive, so the Connection lands in reauth (recoverable by one admin click) instead of retrying forever |
| **US-5.1 racing US-2.1 (disconnect then immediate reconnect)** | Token Set cleared, then a new one written; Connection Binding persists across both | US-4.2 | If disconnect deleted the row, the previous Resource is gone and the changed-Resource warning silently never fires — losing the protection precisely when an admin is fiddling | § 6.10: clear strips OAuth keys only, keeping the Connection Binding, so US-4.2's comparison basis survives |
| **US-0.1 (test double is a fake AS, not a mocked client)** | test-time module resolution of `openid-client` | every protocol criterion in every phase | If the fake AS were built by mocking `openid-client`, every "real round-trip" criterion would be vacuously true — the engine under test would be the mock | Fetch-level double + the Jest transform allowlist (§ 4); the enterprise SSO test is the cautionary precedent, not the model |
| **Admin rotates `clientSecret` while a worker persists a Token Set** | whole credential blob rewritten by both | US-3.1, US-2.1 | `save`/`saveField` rewrite the entire blob, so one write silently loses; the Refresh Lock does not cover this pair | § 10 #12 — leaning toward extending the compare-and-set to the whole blob, which follows from § 1.4 invariant 4 almost for free |
| **A cached `reauthRequired` survives a successful reconnect** | state says broken, credentials say healthy | US-4.1, US-3.1 | A stale precondition makes the UI nag about a Connection that now works, training admins to ignore the banner — the same erosion § 6.7 exists to prevent | Reconnect clears reauth state in the same transaction that stores the new Token Set; the health probe is a detector, never the only writer |

#### Checklist (domain stories)
- [x] Every story: persona (or explicit system actor) + action + measurable outcome + success criteria
- [x] Every story has alternate and failure paths; N/A cases say why
- [x] Every story traces to a workflow
- [x] Identity checkpoint: US-1.x is a build-time developer (non-persona, § 2), US-3.x is a system actor, the rest are internal admin/staff
- [x] No weak verbs — no "manage"/"handle"/"track"
- [x] Cross-story impact matrix covers every story, including the migration, with named mitigations rather than deferrals — **seven rows added after the DDD gate found US-2.2, US-3.2, US-0.1, disconnect-racing-reconnect, the client-secret write race and the stale-reauth precondition all missing**

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
| Pure protocol/crypto primitives: state-cookie encrypt/verify, token-endpoint POST, PKCE helpers | **`packages/shared/src/lib/oauth2/`** | These have **zero domain dependencies** — verified: `oauth-state.ts:1` imports only `node:crypto` and `oauth-token.ts` imports nothing — which is precisely `shared`'s stated charter ("cross-cutting utilities… MUST NOT import from `@open-mercato/core` or any domain package"), and `shared` already hosts `src/modules/integrations/types.ts` including `IntegrationCredentialFieldOauth`. Putting them here is also what makes the optional Phase 4 SSO de-duplication trivial: `enterprise` already depends on `shared`, so one of the two duplicate state-cookie copies can simply go away without any import-direction gymnastics. **Note:** adding a public type here is itself an `Ask First` item under `shared/AGENTS.md` ("a shared public type that becomes a cross-package contract") |
| The OM-integrated toolkit: descriptor registry, generic routes, credential storage, Refresh Lock, reauth classification, health check, Connect UI | **`packages/core/src/modules/integrations/lib/oauth2/`** (+ `api/oauth/[provider]/*`) | These necessarily reach `integrationCredentialsService`, `IntegrationState` and the admin UI — all core/`integrations` concerns, so they cannot live in `shared` |

Deprecation re-exports stay at the current `communication_channels/lib/oauth-{state,token}.ts` paths for ≥1 minor version per `BACKWARD_COMPATIBILITY.md`, since `channel-gmail` imports them today (§ 0.3 #5).

**Redirect-URI building is explicitly NOT in the primitive list** — the architect checkpoint found `shared/src/lib/url.ts:240-250` already provides `getAppBaseUrl`/`toAbsoluteUrl`. The first draft listed it as new work; it is reuse.

### 6.4 PKCE default

**Recommendation: on by default, per-provider opt-out with a recorded justification, and never an automatic runtime downgrade. The first consumer confirms the default costs nothing:** Xero documents PKCE support explicitly — *"Xero supports the Proof Key for Code Exchange (PKCE) extension to the authorization code flow"* — so the opt-out stays an escape hatch for non-compliant providers rather than something the first real integration needs. RFC 9700 and OAuth 2.1 both require PKCE for confidential clients; OM currently uses it in zero integration flows (§ 0.3 #1-2) while its own enterprise SSO module uses it correctly — an inconsistency worth ending. The no-auto-downgrade rule matters because a fallback-on-error path converts a defense into a negotiation an attacker can force.

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

**Two corrections to the first draft, both from the architect checkpoint.**

First, **a generic helper does exist** — the first draft asserted it did not. `packages/tillio/src/modules/tillio/lib/locking.ts:16` has `createTillioLock(em, key)`: roughly 30 lines of `em.transactional` wrapping `pg_advisory_xact_lock`, exactly the abstraction claimed to be absent. Raw inlined SQL still exists in `attachments`, `notifications`, `query_index`, `packages/documents`, twice in enterprise `record_locks`, and once in `enterprise/sso/services/ssoConfigService.ts` — seven precedents, not six. So the work is **promoting an existing 30-line helper to `shared`**, not designing one, and § 4 rescores it from 2 commits to 1. The six raw call sites remain candidates to adopt it later — a real platform win worth naming in the Phase 2 pitch.

Second, **the blocking variant is the wrong primitive.** `pg_advisory_xact_lock` waits indefinitely, which flatly contradicts US-3.1's "lock acquisition times out -> typed transient error". The implementation uses **`pg_try_advisory_xact_lock` with bounded retry** (or sets `lock_timeout` for the transaction), so that a stuck holder produces a typed transient failure instead of an unbounded wait. This also bounds the interaction with `packages/shared/AGENTS.md`'s connection-budget invariant, since an advisory lock pins a pooled connection for the duration of a third-party HTTP round trip (WF3 edge 4).

### 6.7 Failure classification — three classes, not two

**Recommendation:** set `reauthRequired` **only** on a definitive credential failure — an OAuth2 `invalid_grant` (or a provider-documented equivalent) from the token endpoint. Network errors, timeouts, 5xx, and rate limits are transient: retry with backoff, leave the flag alone, and let the health probe be the eventual detector. The asymmetry is deliberate: a false "needs reauth" trains operators to ignore the banner, which is worse than a slightly slower true detection.

**A third class was missing, and the first consumer found it.** The original taxonomy split failures into *transient* and *reauth*. Xero returns **`401` with `WWW-Authenticate: insufficent_scope`** (Xero's own spelling) when a call needs a scope the grant does not carry — and that case fits neither box:

| Class | Token state | Correct action | Wrong action it would otherwise get |
|---|---|---|---|
| Transient | valid | retry with backoff | — |
| **Reauth** | refresh token dead | re-run the authorization flow with the **same** scopes | — |
| **Re-consent (new)** | **token perfectly valid** | re-run the authorization flow with a **wider scope set**, then retry | Classified as transient, it retries forever against a `401` that will never clear. Classified as reauth, it sends the admin through a consent flow that **re-grants exactly the scopes that were already insufficient** — the banner clears, the call fails again, and the loop repeats |

So the toolkit must branch on the `WWW-Authenticate` challenge rather than on the bare `401` status. Xero's own guidance is to do exactly this: *"We recommend updating your error handling to specifically catch 401s and prompt the user to 'Update Permissions.'"*

**Two consequences beyond the classification itself.** First, the reauth *banner copy* differs per class — "reconnect your account" is wrong advice for a scope problem, where the honest message is "this integration now needs additional permissions". Second, this class is **not recoverable without a descriptor change**: a wider scope set has to be declared in code and deployed before any admin can consent to it, so the runtime path is "surface it clearly and stop", not "prompt and retry".

**It interacts with a one-way door.** OAuth scopes are additive, and at least one provider states plainly that they cannot be narrowed: Xero's *"It's not possible to remove scopes from an existing access token. The only way to reduce consented scopes is to revoke the token and start again."* That cuts both ways for descriptor authors — under-requesting costs a re-consent round across every connected tenant, and over-requesting cannot be quietly walked back. § 5's US-2.3 (granted scopes narrower than requested) is the detection half of this; this class is the runtime half.

### 6.8 Migrating Gmail without breaking live Connections

**Recommendation:** treat PKCE as affecting **only new authorization flows**. A stored refresh token obtained without PKCE keeps refreshing normally — PKCE binds an authorization *code* to a token request and plays no part in the refresh grant. So the migration is: point Gmail's descriptor at the toolkit, keep the stored Token Set shape compatible, and prove with a test that an existing Token Set still refreshes after the switch. Redirect-URI stability is the one genuine hazard — if the callback route path changes, every tenant must re-register the URI in Google Cloud Console, which is a migration cost no amount of code care avoids. § 10 #6 makes that an explicit decision (keep the legacy per-hub callback path working for migrated providers, or accept re-registration).

### 6.9 Where does per-Connection reauth state live? **(new — the DDD gate's most consequential finding)**

The first draft said reauth is "surfaced via the existing `IntegrationState.reauthRequired`". That works for tenant-wide Connections and **breaks for per-user ones**: `IntegrationState` has no `user_id` (`entities.ts:97-140`), so every per-user credential row for a provider collapses onto **one** state row. The flag therefore cannot express "Jane's mailbox is dead, Bob's is fine" — which breaks US-4.1, leaves the generic health check with no defined subject (which Connection does it probe?), and collides with Phase 3: `communication_channels` keeps its own per-channel `status: 'requires_reauth'` and never touches `IntegrationState` at all, so a Gmail migration either regresses per-mailbox granularity or creates two reauth stores that must be reconciled.

| Option | Trade-off |
|---|---|
| **(a) Scope reauth state per Connection** — add `user_id` to `IntegrationState`, or add a per-Connection state row | Correct, and the only option under which US-4.1 and the health check are well-defined for per-user providers. Costs a migration on a shared entity plus a reconciliation path for the existing `communication_channels` per-channel status. ~2 commits (§ 4) |
| (b) Declare per-user reauth out of scope and **drop Gmail from Phase 3** | Cheapest and honest. But it leaves the duplication this spec exists to remove in place for the one provider that has it worst, which undercuts the spec's premise |
| (c) Keep the single state row and let it mean "at least one Connection needs reauth" | Cheapest to build, worst to operate: a single dead mailbox makes the whole provider look broken to every tenant admin, and nothing tells them which one. Rejected |

**Recommendation: (a)**, with the reconciliation stated explicitly — the toolkit owns reauth state, and `communication_channels`' per-channel `status` becomes a projection updated by an `integrations.connection.reauth_required` subscriber rather than a second source of truth. **This is a gating decision** (§ 10): under (b) the Phase 3 scope and its commit budget both change materially.

### 6.10 What does "clear the Token Set" actually mean? **(new)**

WF5 said "clears the Token Set" without defining it, and the two readings differ in operator-visible ways.

| Option | Trade-off |
|---|---|
| Soft-delete the whole `integration_credentials` row | Simplest, and unambiguously removes the secret. But it also discards the admin's `clientId`/`clientSecret`, so a reconnect means re-entering app credentials — punishing the common "disconnect to fix something, reconnect immediately" case |
| **Strip only the OAuth keys, keep the app credentials and the Connection Binding** | Reconnect is one click. Requires the clear to be precise about which keys are secret-bearing, and requires the row to survive — which is also what makes the Connection Binding's previous Resource available to WF4's changed-Resource warning (§ 1.3) |

**Recommendation: strip the OAuth keys, keep `clientId`/`clientSecret` and the Connection Binding**, and implement it as an explicit `clearTokenSet` method rather than `save({})`. Note this is real work: `credentialsService` exposes **no** delete or clear method today (`getRaw`/`getRowUpdatedAt`/`resolveUpdatedAt`/`resolve`/`save`/`saveField`/`getSchema`), so the first draft's "the service is there" was an overstatement.

### 6.11 Should the toolkit write other modules' state, or emit events? **(new)**

The first draft had WF5 pausing `data_sync` schedules and Phase 3 updating `communication_channels` channel status — a generic toolkit reaching into two specific consumer modules, which `integrations/AGENTS.md:29` ("never import provider modules") forbids and which § 6.3's whole dependency argument exists to avoid.

**Recommendation: emit the four `integrations.connection.*` events of § 1.4 and let consumers subscribe.** Schedule pausing becomes a `data_sync` subscriber; channel-status projection becomes a `communication_channels` subscriber; provider-side mapping reconciliation on a changed Resource becomes a provider subscriber. `createModuleEvents` and the subscriber pattern are mature (`core` -> Events), so this is ~1 commit, and it is the difference between a toolkit and a hub with extra steps. Per `integrations/AGENTS.md:16`, provider-specific behaviour reaches the toolkit only through DI-registered services and registry hooks — never a direct import (§ 4.5).

### 6.12 The state cookie's name and HKDF info string are channel-branded **(new)**

`oauth-state.ts:28-33` bakes `communication_channels` into both the HKDF `info` string and the cookie name. Moving the file to `shared` verbatim would have a generic module exporting channel-named public API; renaming them **invalidates every in-flight state cookie** (a user mid-consent gets a failed callback) and changes derived key material.

| Option | Trade-off |
|---|---|
| **Keep both strings verbatim, document them as legacy constants** | Zero breakage, zero migration. Costs a permanently odd name in a generic module, mitigated by a comment explaining exactly why it cannot change |
| Rename, accepting that in-flight consents fail | Clean naming. Breaks only a ~10-minute window of in-flight flows, but for no functional gain — and a derived-key change means any cookie issued before the deploy is undecryptable, not merely stale |
| Dual-read: accept both names for one release, issue only the new one | Correct and non-breaking, but it is real code and test surface for a cosmetic win |

**Recommendation: keep both strings verbatim as documented legacy constants.** A generic module with one oddly-named constant is a smaller cost than a migration whose only benefit is aesthetic.

#### Checklist
- [x] Every decision presented as options with trade-offs and a recommendation — none decided silently
- [x] Recommendations grounded in verified repo facts (§ 0.3) or named RFCs (§ 0.1), not preference
- [x] The cheap fallback (Option A) preserved rather than dismissed
- [x] Decisions added for every gap the two review gates found undecided (§ 6.9-6.12)

---

## 7. Phasing & Rollout `PM`

### Phase 1: Protocol core + one provider end-to-end

**Goal:** a descriptor-driven, PKCE-protected connect/**use**/disconnect flow exists and is proven by exactly one provider — where "use" means a consumer can obtain a valid access token without writing refresh code.

**Why this order:** the descriptor + routes + client wrapper are mutually useless apart; and a toolkit with no consumer is unvalidated. Xero (already specced, § 8) is the natural first consumer because it needs Resource Selection, the hardest hook — proving the extension point rather than deferring it.

**Sequencing decided 2026-09-27: this toolkit ships before the Xero integration.** That makes the relationship a dependency rather than a preference, with consequences in both directions:
- **For Xero**, its WF1 drops from 5 commits to 2 — it declares a descriptor and implements one Resource Selection hook instead of building an OAuth flow — and it inherits PKCE, RFC 7009 revocation and cluster-safe refresh. Its Phase 1 falls from 11 commits to 8, and its total from 22 to 19.
- **For this spec**, the gating questions are now blocking *two* deliverables, not one. § 10 #2 (approving `openid-client` as a `core` production dependency) and § 10 #11 (the `Ask First` sign-off on the descriptor type and the canonical route shape) hold up the Xero integration as well.
- **Validation improves.** Xero's research has already fed three corrections back into this document before a line of code exists — the `refreshRetryGraceMinutes` window (§ 1.4 invariant 5), the third failure class (§ 6.7), and the scope one-way-door constraint. That is the payoff of naming a real first consumer rather than designing against a hypothetical one, and it argues for treating the Xero descriptor as part of Phase 1's acceptance rather than as downstream work.

**Re-phased after the DDD gate.** The first draft's Phase 1 shipped connect and disconnect but left `getAccessToken` and the failure taxonomy to Phase 2 — which meant every Phase-1 consumer had to hand-roll refresh, i.e. reproduce the exact duplication this spec exists to remove, and then delete it one phase later. `getAccessToken`, the in-process short-circuit and the failure taxonomy therefore move **into Phase 1**; Phase 2 keeps only what genuinely needs the cross-process machinery.

| Story | What ships | Commits |
|---|---|---|
| US-1.1, US-1.2 | Descriptor type (incl. the PKCE opt-out field with required justification, `requiredFeature`, `perUserScoped`), registry wiring, generator discovery, registration-time validation errors | 2 |
| US-1.1 | The `oauth` credential-field renderer — keeping the field out of the CrudForm value model and reusing the existing generic Connect hook (rescored to 1, § 4) | 1 |
| US-2.1, US-2.2 | `openid-client` in core + `OAuth2Client` wrapper; generic initiate/callback routes; state cookie + PKCE; no-refresh-token warning | 4 |
| US-1.1 (hook) | Resource Selection **hook** (Xero's picker ships as a provider-injected widget, § 4) | 1 |
| **Migration** | **Missing partial unique index on tenant-wide credentials** — `WHERE user_id IS NULL AND deleted_at IS NULL` (§ 1.4 invariant 1), plus a duplicate-reconciliation step before the index can be created | 1 |
| **US-3.1** | **`getAccessToken` with the in-process short-circuit, row-identity reads and compare-and-set persistence** (§ 1.4 invariants 3-5) | 2 |
| **US-3.1** | **Failure taxonomy — transient / reauth / re-consent (§ 6.7)** + report-once semantics + the token-response zod boundary (§ 1.4 invariant 6) | 1 |
| US-5.1 | Disconnect: revoke where declared **and** actually clear the stored Token Set via an explicit `clearTokenSet` (§ 6.10) | 1 |
| US-0.1 | Fake authorization server (fetch-level, not a mocked `openid-client`) + the Jest transform allowlist + PKCE/`state`/`iss` round-trip tests | 2 |

**Total: 15 atomic commits**

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] A Connection has at most one Token Set at any time — **enforced by a database constraint for both tenant-wide and per-user Connections**, not merely by convention; a failed connect leaves none (no partial row).
- [x] Every authorization request carries a `code_challenge` unless the descriptor explicitly opted out; no code path emits an authorization request without either PKCE or a recorded opt-out.
- [x] A callback with an invalid/expired/foreign `state`, or a mismatched `iss`, results in **no token-endpoint call** — the failure precedes any exchange.
- [x] A Token Set is never emitted to a log, URL, telemetry attribute, or run parameter.
- [x] **A refresh writes back to the row it read from, identified by row id; no refresh path can create a row** — proven by a test in which a user-scoped Connection falls back to a tenant-wide Token Set and the rotation does *not* produce a second row (§ 1.4 invariant 3).
- [x] **A Token Set is only ever constructed from a zod-parsed token response**; a malformed or implausible response stores nothing (§ 1.4 invariant 6).

**Business criteria** `PM`:
- [x] An admin can connect one real provider end-to-end (Xero Demo Company or Gmail test account) and see the connected resource named.
- [x] **A consumer can call the provider's API through `getAccessToken` and write no refresh code** — this is what makes Phase 1 a usable increment rather than a half-toolkit.
- [x] Disconnect clears locally and revokes remotely where the descriptor declares it; a reconnect does not require re-entering the client secret (§ 6.10).
- [x] A developer can add a second provider with a descriptor and no protocol code.

**Value delivered:**
- **Business value:** the next OAuth2 integration is configuration, not protocol engineering — and it is PKCE-protected by default rather than by diligence.
- **ROI metric:** OAuth portion of a new provider ≤2 commits (baseline ~5); PKCE coverage of new flows 100% (baseline 0%).
- **Honest limit:** single-process correctness only. A deployment running web + worker, or >1 replica, against a rotating-refresh provider still has today's race until Phase 2 — this is stated rather than implied, and it is why Phase 2 is not optional for `data_sync` consumers.

**PM's challenges to the DDD criteria:** the PM pushed back on requiring the "never in telemetry attributes" criterion in Phase 1, since no telemetry emission is being added here — but it was kept, because the toolkit is where every future provider's token handling will be written, and establishing the invariant before there are five consumers is much cheaper than retrofitting it. All four accepted.

### Phase 2: Correctness under concurrency

**Goal:** a Connection cannot be broken by two processes refreshing it at once, and a broken Connection announces itself.

**Why this order:** Phase 1 is demonstrably useful but shares today's cross-process weakness; this phase is what makes the toolkit safe for unattended background workers — i.e. for `data_sync`, which is the main consumer.

| Story | What ships | Commits |
|---|---|---|
| US-3.2 | `withAdvisoryLock()` promoted into `shared` from `packages/tillio/.../locking.ts:16`, switched to `pg_try_advisory_xact_lock` with bounded retry (§ 6.6) | 1 |
| US-3.1, US-3.2 | Refresh Lock wired into the existing `getAccessToken`; re-read-under-lock; the waiter-sees-reauth branch (WF3 edge 2); bounded provider HTTP timeout inside the lock (WF3 edge 4) | 1 |
| **US-4.1** | **Per-Connection reauth state** (§ 6.9 option (a)) + reconciliation with `communication_channels`' per-channel status | 2 |
| US-4.1 | Generic OAuth health check wired to the existing 15-min probe | 1 |
| US-4.2 | Changed-Resource detection driven by `integrations.connection.resource_changed` | 1 |
| **Events** | The four `integrations.connection.*` events + moving schedule pausing and channel-status updates into subscribers (§ 6.11) | 1 |
| US-0.1 | Concurrency test: two workers, one Connection, rotating provider -> exactly one refresh | 1 |

**Total: 8 atomic commits**

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] At most one refresh per Connection is in flight cluster-wide; a concurrent caller observes the winner's Token Set rather than performing a second exchange.
- [x] **A waiter that finds the winner set reauth returns the reauth failure** — it does not block again and does not retry the dead refresh token (WF3 edge 2).
- [x] **A persist failure after a successful remote rotation is classified definitive once the provider's `refreshRetryGraceMinutes` window has closed** — outside that window the old refresh token is already invalid at the AS, so a retry cannot succeed and treating it as transient would hide a bricked Connection behind backoff (§ 1.4 invariant 5). *This replaces the first draft's "persisted in the same commit" criterion, which the DDD gate showed to be nearly vacuous: both tokens live in one JSON column, so one UPDATE satisfies it trivially while the real window — AS-commit versus DB-commit — went unaddressed. The grace window itself was then added after the first consumer's research found a provider that allows a 30-minute retry.*
- [x] **Lock acquisition is bounded**: a stuck holder yields a typed transient error rather than an unbounded wait (§ 6.6).
- [x] A crashed lock holder releases the lock without operator action; no Connection becomes permanently unrefreshable.
- [x] `reauthRequired = true` only ever follows a definitive credential failure, never a transient one — **and is scoped to the individual Connection**, so one dead per-user Connection does not mark its siblings (§ 6.9).

**Business criteria** `PM`:
- [x] A concurrency test (two workers, one Connection, rotating provider) shows exactly one refresh and zero flaps.
- [x] An admin sees a reauth banner within one health-probe interval of a definitive failure, **naming which Connection** when the provider is per-user.
- [x] Reconnecting to a different remote resource produces an explicit warning naming both, **and the provider that owns the affected mappings is notified by event** rather than relying on the admin to act.

**PM's challenges to the DDD criteria:** the PM questioned whether same-commit persistence of access+refresh tokens was over-engineering versus "persist both, best effort" — and lost, though not in the way either party expected: the DDD gate then showed the criterion itself was near-vacuous (one JSON column, one UPDATE) and the real hazard was the AS-commit/DB-commit window. The criterion was replaced rather than merely kept, which is the more useful outcome of the argument. All six accepted.

### Phase 3: Retire the duplication

**Goal:** one protocol path in the repo, Gmail included; the old utility locations remain importable but deprecated.

**Why this order:** migrating the one live provider is only safe once the toolkit is proven (Phases 1-2). Doing it last also means the migration's risk is carried by working, tested code rather than by a design.

| Story | What ships | Commits |
|---|---|---|
| Migration | Re-home the pure primitives into `shared/lib/oauth2/` with BC re-export shims at the `communication_channels` paths, keeping the channel-branded HKDF info string and cookie name verbatim as documented legacy constants (§ 6.12) | 1 |
| Migration | `channel-gmail` onto the toolkit (gains PKCE, drops its bespoke Connect widget in favour of the generic renderer, sets `requiredFeature` to its existing ACL feature so no ACL contract changes); prove existing Token Sets keep refreshing | 2 |

**Total: 3 atomic commits — but this budget is conditional, and the condition is load-bearing.** It presumes § 10 #6 resolves to keeping the legacy per-hub callback path working for migrated providers. If instead both paths must be routed generically, dual-path callback routing is unestimated work and this phase grows. It also presumes § 6.9 resolves to option (a); under option (b) Gmail leaves Phase 3 entirely and the phase reduces to the re-home commit alone.

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
Phase 1: Protocol core + usable first provider  15 commits   WF1, WF2, WF5, WF3(single-process), US-0.1
Phase 2: Correctness under concurrency           8 commits   WF3(cluster), WF4, events, US-0.1
Phase 3: Retire the duplication                  3 commits   Migration (conditional — see Phase 3)
                                               ---------
                                               26 commits for production-ready (Phases 1-3)
Phase 4: State-cookie de-duplication (opt.)      1 commit    debt only, droppable
                                               ---------
                                               27 commits if Phase 4 is taken
```

Phases 1-3 total 26 against § 4's 25 because the Phase-1 re-phasing splits `getAccessToken` work across two commits that § 4 scores as one unit; the discrepancy is in presentation, not scope.

#### Checklist
- [x] Phases ordered by priority x gap x blocker status; the live-provider migration deliberately last
- [x] Each phase delivers a complete, usable increment — **corrected after the DDD gate**, which showed the first draft's Phase 1 was *not* one: it shipped connect/disconnect without `getAccessToken`, so every Phase-1 consumer would have hand-rolled the refresh logic this spec exists to remove, then deleted it in Phase 2
- [x] Acceptance criteria per phase: DDD wrote domain criteria, PM challenged them — two challenges recorded as rejected-with-reason, one as reworded, one accepted; one criterion later **replaced** when the review gate showed it was near-vacuous
- [x] Business value + ROI metric per phase; no artificial phase (P4 is marked optional rather than padded into the total)
- [x] Phase 3's conditional budget stated as conditional, with both conditions named (§ 10 #6, § 6.9)

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
| 3 | ~~Does a reusable advisory-lock helper already exist?~~ | — | — | Architect | **Answered twice, and the second answer reversed the first.** The self-audit concluded "no helper exists"; the architect checkpoint then found `createTillioLock` at `packages/tillio/src/modules/tillio/lib/locking.ts:16` — ~30 lines of `em.transactional` + `pg_advisory_xact_lock`, exactly the abstraction claimed absent. So the work is promoting it to `shared`, not writing it (§ 0.3 #12, § 6.6), and § 4 drops a commit. The first draft's separate claim that `data_sync` uses an advisory lock was also wrong |
| 4 | Should the connect/callback write use the credentials row's existing optimistic locking, so two concurrent admins get a visible conflict instead of a silent overwrite? | (a) Yes — reuse `resolveUpdatedAt` (b) No — last write wins, accept orphaned tokens | Low (rare) but a confusing failure when it happens | PM + Architect | Open — leaning (a); § 5 impact matrix documents the exposure |
| 5 | ~~Is there already a fake/mock authorization server in the test setup?~~ | — | — | Architect | **Answered by the audit: no.** No `nock`/`msw`/HTTP double exists, and SSO's only protocol test `jest.mock`s `openid-client` wholesale, so **no test anywhere exercises a real OAuth round-trip** (§ 0.3 #14). US-0.1 introduces new test infrastructure; Phase 1 should budget for it explicitly rather than assuming fixtures exist |
| 6 | Callback URL strategy for migrated providers: keep the legacy per-hub path working (`/api/communication_channels/oauth/[provider]/callback`) or move everyone to `/api/integrations/oauth/[provider]/callback` and require tenants to re-register redirect URIs in each provider's console? | (a) Keep legacy paths as aliases for migrated providers — no tenant action (recommended) (b) Single canonical path, tenants re-register | **High for Phase 3** — (b) is a breaking operational change for every live tenant | PM + Architect | Open — leaning (a); § 6.8 explains why this is the one hazard code care cannot remove |
| 7 | Should `enterprise/sso` ever share more than the state cookie with this toolkit? | (a) No — permanent boundary (recommended, § 6.5) (b) Revisit if a third OAuth-login use case appears | Low | Architect | Open — recommended default (a) |
| 8 | What happens to `sync-akeneo`'s ROPC (`grant_type=password`) flow, which OAuth 2.1 removes and this toolkit deliberately won't host (§ 0.3 #10, § 1.2)? | (a) Leave it alone — it works, Akeneo's API supports it, and touching it is unrelated risk (b) Migrate Akeneo to authorization-code via this toolkit, if Akeneo supports it for the tenant's deployment type (c) Keep ROPC but at least move its in-closure token state into encrypted credential storage | Medium — it is the weakest of the three flows (credentials exchanged directly, token state in a module variable) but also the least exposed (no redirect, no browser) | Architect + whoever owns `sync-akeneo` | Open — leaning (a) for this spec's scope with (c) as a cheap improvement; explicitly **not** silently absorbed into the toolkit |
| 9 | Should the `redirect_uri` request-origin fallback (`NEXT_PUBLIC_APP_URL \|\| APP_URL \|\| resolveRequestOrigin(req)`) be tightened for OAuth flows specifically, given RFC 9700 requires exact redirect-URI matching (§ 0.3 #15)? | (a) Require an explicitly configured base URL for OAuth initiate/callback and fail loudly when absent (b) Keep the request-origin fallback as-is for developer convenience | Medium — a proxy/Host-header mismatch silently changes the computed `redirect_uri` and breaks consent with a confusing provider-side error | Architect | Open — leaning (a) for OAuth paths only, keeping the fallback everywhere else |
| 10 | **Where does per-Connection reauth state live?** `IntegrationState` has no `user_id`, so it cannot represent per-user Connections (§ 6.9) | (a) Scope state per Connection — migration + reconcile with `communication_channels`' per-channel status (recommended) (b) Declare per-user reauth out of scope and drop Gmail from Phase 3 (c) One row meaning "at least one Connection is broken" (rejected) | **High — gates Phase 2's scope and Phase 3's existence.** Under (b) the Gmail migration leaves the plan entirely | PM + Architect | Open — **added by the DDD gate**; leaning (a) |
| 11 | **`integrations/AGENTS.md:23` lists "registry type contracts" and "canonical API routes" as `Ask First` items, and this spec changes both** — yet § 10 previously flagged only #2 and #6 as gating | (a) Seek explicit maintainer sign-off on the descriptor type contract and the `/api/integrations/oauth/[provider]/*` route shape before Phase 1 (recommended) (b) Treat them as covered by the general platform-contribution buy-in of § 4 | **High — gates Phase 1**, and cheaper to ask than to rework a shipped contract surface | Maintainers | Open — **added by the architect checkpoint**; leaning (a). Note `shared/AGENTS.md` adds its own `Ask First` for new cross-package public types (§ 6.3) |
| 12 | Should the admin's rotation of a `clientId`/`clientSecret` be serialized against a concurrent worker persisting a Token Set? `saveField`/`save` rewrite the whole credential blob, so one silently loses; the Refresh Lock covers refresh-vs-refresh only | (a) Extend the compare-and-set to the whole blob, so the loser retries on a stale version (b) Accept it — rotation is rare and an admin can re-enter the secret (c) Take the Refresh Lock for credential-field writes too | Medium — rare, but the failure is silent and the symptom (a Connection that stops working right after a routine secret rotation) is very hard to diagnose | Architect | Open — **added by the DDD gate**; leaning (a), which falls out of § 1.4 invariant 4 nearly for free |

#### Checklist
- [x] Every question has options, impact, owner, status
- [x] The gating questions are flagged as blocking their phase, not buried — now four (#2 dependency approval, #6 callback strategy, #10 reauth-state scoping, #11 Ask First on contract surfaces), where the first draft listed two
- [x] Decided questions live in § 6 with rationale, not duplicated here
- [x] Reversed answers are shown as reversed (#3), not quietly rewritten

---

## Production Readiness `PM`

| Workflow | Deployable | Blocker | What the client would say |
|---|---|---|---|
| WF1 Developer adds provider | After Phase 1 | Open Questions #2 (dependency approval), #11 (`Ask First` on the descriptor type + route contract) | "Adding the next integration didn't mean re-reading the OAuth spec." |
| WF2 Admin connects | After Phase 1 | None | "Connecting Xero felt exactly like connecting Gmail." |
| WF3 Transparent refresh | **Single-process: after Phase 1. Multi-process: after Phase 2** | None (Phase 1 first) | "It stopped asking me to reconnect every few days." |
| WF4 Reauth surfacing | After Phase 2 | Open Question #10 (where per-Connection reauth state lives) | "It told me the connection died instead of just going quiet — and told me *which* mailbox." |
| WF5 Disconnect + revoke | After Phase 1 | None | "When I disconnected, it was actually gone from my Google account too." |
| Migration (Gmail) | After Phase 3 | Open Questions #6 (callback URL strategy), #10 (under option (b) this migration is dropped) | "I didn't notice anything — which is what I wanted." |

**Honest note on WF3 before Phase 2:** shipping Phase 1 alone leaves the cross-process refresh race exactly as it is today — no worse, but not fixed. A deployment that runs workers separately from web (the normal production topology) should not be told the concurrency problem is solved until Phase 2 lands. What Phase 1 *does* now deliver, after the re-phasing, is a usable `getAccessToken` — so consumers write no refresh code even while the cluster-wide guarantee is still pending.

**Honest note on the review gates.** This document's estimate moved from 19 to 25 commits across a self-audit and two independent review gates, and several first-draft claims were disproved outright: the uniqueness invariant was credited to an index that does not cover the primary case, the Connection aggregate could not represent per-user reauth, the Refresh Lock was described as solving a race that a read-fallback/strict-write asymmetry would have kept open, and a lock helper described as missing already existed. Those are not cosmetic corrections — three of them would have shipped as bugs. The estimate should be read as "the version that survived being attacked twice", not as a floor.

#### Checklist
- [x] Each workflow assessed binary with its specific blocker
- [x] "What would the client say" phrased as the complaint/praise, not the technical gap
- [x] No workflow stops midway; the Phase-1-without-Phase-2 caveat is stated rather than glossed
- [x] WF3's split readiness (single- vs multi-process) stated rather than averaged into one misleading answer

---

## Changelog

### 2026-09-26
- Initial draft, on a fresh branch off `develop`. Written with `om-app-spec-writing` after the Xero App Spec surfaced OAuth reuse as a recurring platform question rather than a Xero-specific one.
- **Standards research** (§ 0.1) from trained knowledge — live web access was denied in this environment for the whole session, so § 10 #1 carries a pre-implementation verification task. **Prior-art survey** (§ 0.2) covers Nango, Auth.js, arctic, `openid-client`, Airbyte and Passport with explicit adopt/reject calls.
- **Repository findings** (§ 0.3) read directly from code, and they reframed the proposal: Gmail's OAuth flow has **no PKCE** (`channel-gmail/.../lib/oauth.ts:64-88`); refresh coalescing is an in-process `Map` (`credential-refresh.ts:60`) that cannot serialize OM's separate web and worker processes; the `oauth` credential-field type is declared but refused by the admin UI; the state-cookie pattern already exists **twice** (core + enterprise, forced by the import ban); and decisively, **`packages/enterprise` already depends on `openid-client` ^6.8.4 and uses it correctly with PKCE and discovery** (`sso/lib/oidc-provider.ts:36,39,70,147,153`) — the professional approach is already in this repo, in the commercial package, for a different use case, while core's OSS integration flow reinvented a weaker version.
- Eight decisions presented as options with recommendations (§ 6): build vs. narrow, adopt `openid-client` vs. hand-roll, where it lives, PKCE default, the SSO boundary, the Refresh Lock mechanism, reauth classification, and the Gmail migration. The narrow proposal from the `xero-integration` branch is preserved as the explicit fallback rather than discarded.
- **Revised the same day against a dedicated repo audit** (dispatched as a fresh-context subagent; findings recorded as § 0.3 #10-15). It corrected three assumptions this document was drafted on and added three findings: (1) a **third** client-side OAuth implementation exists — `sync-akeneo` uses ROPC (`grant_type=password`), a grant OAuth 2.1 removes — now explicitly out of scope with its own open question (§ 10 #8) rather than silently absorbed; (2) `data_sync` does **not** use an advisory lock as first drafted — the pattern has six inlined precedents elsewhere and **no shared helper exists**, so the toolkit writes one (§ 10 #3 answered, § 6.6); (3) **no mock authorization server and no real-protocol round-trip test exist anywhere**, and SSO's only protocol test mocks `openid-client` wholesale — so test infrastructure is genuinely new work, scored as +2 commits that the first draft had assumed free (§ 10 #5 answered, § 4); (4) disconnect is **worse** than "no revocation": it nulls a pointer and leaves the `integration_credentials` row intact, so a valid encrypted refresh token survives a disconnect (§ 0.3 #13) — WF5 now fixes two things; (5) the cross-process refresh race is **latent, not active**, because Google doesn't rotate refresh tokens — WF3's ROI restated honestly as preventing Xero's guaranteed problem rather than fixing a current Gmail one; (6) redirect URIs fall back to the request origin when `APP_URL`/`NEXT_PUBLIC_APP_URL` are unset, which conflicts with RFC 9700's exact-match requirement (new § 10 #9). The audit also let § 6.3 improve on the first draft: pure primitives belong in `packages/shared` (zero domain deps, and it makes the optional SSO de-duplication trivial), with only the OM-integrated parts in `integrations`. Totals moved 19 -> 21 commits as a result.
- **Ran the two mandatory gates** (each as a fresh-context subagent with no access to this session's reasoning) and folded both in. They moved the estimate in opposite directions, which is the point of running both.
  - **Architect checkpoint — removed 3 commits and found 1 blocker.** It disproved three "this does not exist" claims: a generic advisory-lock helper *does* exist (`packages/tillio/src/modules/tillio/lib/locking.ts:16`, ~30 lines — so § 0.3 #12 and § 10 #3 are now corrected *twice*, and the lock work drops 2 -> 1 commit); the credentials UI already has a `type:'custom'` field escape hatch, a provider-key-parameterized Connect hook (`use-connect-channel.ts:16`) and connection status already on its detail payload (renderer drops 2 -> 1); and redirect-URI building already exists in `shared/src/lib/url.ts:240-250` (dropped from § 6.3's primitive list). It also deferred the generic Resource picker as speculative before a second consumer, and found a **test blocker**: `packages/core/jest.config.cjs` does not whitelist ESM-only `openid-client`, so the fake AS must be a fetch-level double, not a mocked client (+1 commit) — with no *build* blocker, since core builds unbundled ESM and `enterprise` already ships it as a prod dependency. Finally it flagged that `integrations/AGENTS.md:23` makes both the descriptor type contract and the canonical route shape `Ask First` items (new § 10 #11).
  - **DDD challenger gate — added 6 commits and disproved four invariants.** The most consequential: (1) the "one Token Set per Connection" invariant was credited to an index that is **partial (`WHERE user_id IS NOT NULL`)**, so tenant-wide Connections — the primary Xero shape — had no uniqueness at all (now Phase 1 migration work); (2) "Connection = credentials row + `IntegrationState`" is not a well-formed aggregate, because `IntegrationState` has **no `user_id`**, so per-user reauth is inexpressible (new gating § 6.9 / § 10 #10); (3) the Refresh Lock was described as fixing a race that `getRaw`'s tenant-row **read fallback** combined with `save`'s **strict user-scoped write** would have left wide open — two Connections sharing one rotated token family under two different lock keys (new § 1.4 invariant 3, plus row-identity + compare-and-set work); (4) "write-after-delete must lose" was unenforceable, because `save()` *creates* a row when none matches, resurrecting a cleared Token Set. It also replaced Phase 2's near-vacuous "same commit" criterion with the real AS-commit/DB-commit window, showed Phase 1 was not a usable increment without `getAccessToken` (re-phased), required domain events instead of the toolkit writing other modules' state (§ 6.11), added the token-response zod boundary, defined what "clear the Token Set" means (§ 6.10), separated the Connection Binding from the Token Set so US-4.2 survives a disconnect, corrected `providerKey` -> `integrationId` as the Connection Key, replaced blocking `pg_advisory_xact_lock` with a bounded acquisition, found the per-user ACL coupling (now a descriptor `requiredFeature`), and filled seven holes in the cross-story impact matrix.
- **Net: 19 -> 21 -> 25 commits**, with three would-have-been-bugs caught before implementation. Four questions now gate a phase (§ 10 #2, #6, #10, #11) where the first draft listed two.
- Remaining before implementation: § 10's open questions, above all the four gating ones. Nothing in this document is blocked on further review.

### 2026-09-27
- **Sequencing decided (user): this toolkit ships before the Xero integration**, turning a preference into a dependency. Xero's WF1 drops from 5 commits to 2 and its Phase 1 from 11 to 8, since it declares a descriptor and implements one Resource Selection hook rather than building an OAuth flow. The corollary matters more than the arithmetic: **this spec's two gating questions (§ 10 #2, `openid-client` as a `core` production dependency; § 10 #11, the `Ask First` sign-off on the descriptor type and canonical route shape) now block two deliverables rather than one.**
- **Three corrections fed back from the first consumer's API research, before any code exists** — which is the return on naming a real first consumer instead of designing against a hypothetical one.
  1. **§ 1.4 invariant 5 was too strict, and now carries a descriptor field.** It declared a persist failure after a successful remote rotation *always* definitive, reasoning that the old refresh token is already dead. Xero documents otherwise: *"If you don't receive a response from a token refresh you can retry using your existing refresh token for up to 30 minutes."* Hard-coding either behaviour is wrong for half the provider population, so the descriptor gains **`refreshRetryGraceMinutes`** (default `0`, preserving the strict behaviour; Xero sets `30`). Inside the window the toolkit retries with the stored token; outside it, the failure is definitive.
  2. **§ 6.7 needed a third failure class.** The taxonomy split failures into *transient* and *reauth*; Xero's `401` with `WWW-Authenticate: insufficent_scope` fits neither, because the token is perfectly valid and the *grant* is too narrow. Misfiled as transient it retries forever against a `401` that will never clear; misfiled as reauth it sends the admin through a consent flow that **re-grants exactly the scopes that were already insufficient**, so the banner clears and the call fails again. The toolkit now branches on the `WWW-Authenticate` challenge rather than the bare status, uses different banner copy per class, and treats this class as not runtime-recoverable — a wider scope set must be declared in the descriptor and deployed before anyone can consent to it.
  3. **Scope changes are a one-way door**, which sharpens US-2.3 and the descriptor guidance: scopes are additive and at least one provider cannot narrow them at all — Xero's *"It's not possible to remove scopes from an existing access token. The only way to reduce consented scopes is to revoke the token and start again."* Under-requesting costs a re-consent round across every connected tenant; over-requesting cannot be quietly walked back. US-2.3 is now explicitly the *detection* half of this and § 6.7's new class the *runtime* half.
- **§ 6.4 reinforced rather than changed:** Xero documents explicit PKCE support, so PKCE-on-by-default costs the first real integration nothing and the opt-out stays an escape hatch for non-compliant providers.
