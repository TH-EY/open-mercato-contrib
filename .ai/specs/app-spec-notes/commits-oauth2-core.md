# Commit plan — OAuth2 grant-lifecycle core (Phase 1, 9 commits)

Companion to `../2026-09-27-app-spec-oauth2-grant-lifecycle.md` §4.1.

## P1 — `withAdvisoryXactLock` (shared)
- `packages/shared/src/lib/db/advisoryLock.ts`: `withAdvisoryXactLock<T>(em, key, fn: (txEm) => Promise<T>, { waitDeadlineMs = 15000, onWait? })` — `key` must be `<namespace>:<parts>` (rejected otherwise)
  - Loop: `em.fork().transactional(tx => select pg_try_advisory_xact_lock(hashtextextended(key,0)))`; acquired → run `fn(tx)` in that same transaction; not acquired → end tx (release connection), jittered back-off (50→1000 ms), call `onWait()` (caller re-reads; may return a result to short-circuit), retry until deadline.
  - `55P03` / `57014` / deadline → `AdvisoryLockUnavailableError` (transient).
  - JSDoc: `fn` MUST do all DB I/O on `txEm`, MUST be bounded (≤ one external call), xact-scoped only (safe under transaction pooling).
- Tests: two connections contend; waiters ≥ poolMax with small pool (no acquire timeouts); fn error releases; onWait short-circuit.
- `packages/shared/AGENTS.md` lib table row (budget check).

## P2 — token-endpoint client + revoke (core/integrations/lib/oauth)
- `requestTokenEndpoint({ url, clientAuthMethod, clientId, clientSecret, params, timeoutMs })` → typed response | `OAuthTokenEndpointError { status?, error?, errorDescription?, kind: 'protocol'|'network'|'timeout'|'invalid_response' }`.
- `revokeToken({ url, clientAuthMethod, clientId, clientSecret, token, tokenTypeHint })` (RFC 7009; 200 on unknown token is success).
- Basic auth: form-urlencode id/secret before base64 (RFC 6749 §2.3.1).
- No hub changes.

## P3 — `integrationCredentialsService.erase(integrationId, scope)`
- Optional method: strict row; `credentials = {}` then `deletedAt = now()`; flush on the service's em (grant service passes a tx-bound instance).
- Tests incl. encryption-disabled mode.

## P4 — `integrationOAuthGrantService` + fake AS + test-only routes (4 commits)
- DI (scoped). API: `getAccessToken(descriptor, owner, { minValidityMs?, rejectedAccessToken?, forceRefresh? })`, `inspectGrant(descriptor, owner)` (no network; returns status/expiry/refreshedAt/lastFailureClass/clientChanged and the access token only if still valid; no lock, no writes), `completeConnect(descriptor, owner, tokenResponse, { providerData })` (always a new row; returns previous `providerData`), `disconnect(descriptor, owner)`.
- Lock key: `oauth_grant:${integrationId}:${tenantId}:${organizationId}:${userId ?? '-'}`.
- Inside the lock: `createCredentialsService(txEm)`, `createIntegrationStateService(txEm)`; grant blob `status` + projection `setReauthRequired` in the same commit.
- Classification per spec §1.4.5; `client_changed` on read only.
- Disconnect: lock → capture → erase + flag clear + `oauth.disconnected` + `oauth.revocation_pending` log entries (tx-bound log service) → commit → release → `onAfterDisconnect(captured)` → revoke → append `oauth.revocation_confirmed|failed`.
- Grant key `${integrationId}__oauth_grant`.
- `packages/core/src/helpers/integration/fakeOAuthServer.ts` (node `http`): modes none / non-revoking / strict(+grace ms), error injection, counters, revocation endpoint.
- Tests: I1 concurrency (20 callers, 2 connections); I2 interleavings incl. disconnect → reconnect → refresh (one live row + one tombstone); I3 per-row classification (grant and flag agree after every commit); I5 erase with revocation down + crash after erase leaves `revocation_pending`; I6 small pool; `inspectGrant` never calls the token endpoint.
- Test-only routes (flag-gated, 404 without the flag; precedent `communication_channels` `test-seed` / `OM_ENABLE_TEST_CHANNEL_SEEDING`): register a test OAuth provider, expose the fake authorization server's token/revoke endpoints and counters, and drive connect / getAccessToken / disconnect. Playwright specs run I1, I2, I6 against real Postgres through them.
- Decoupling test: no `.tsx` imports `integrations/lib/oauth`.

## P5 — flag projection + banner
- `setReauthRequired` in the same transaction as each status change; `integrations.state.updated` emitted on every projection change.
- Detail-page reauth banner (Alert primitive, status tokens) linking to the provider tab; i18n.
- No new event ID or notification type in Phase 1 (both are Phase 3).

## P6 — docs
- integrations `AGENTS.md` "OAuth grants" section; docs mdx page.
