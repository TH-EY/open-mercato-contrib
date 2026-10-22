# Narrow `credential-refresh.ts` off `ChannelAdapter` so OAuth2 providers outside `communication_channels` can reuse it

**Status:** Proposed — spec-only, no implementation yet. Raised as a follow-up from the Xero App Spec (`.ai/specs/2026-09-26-app-spec-xero-integration.md`, § 4.5 / Open Question #4) and its architect checkpoint (`.ai/specs/app-spec-notes/architect-checkpoint-gap-analysis.md`).
**Category:** `communication_channels` (owns the file today) / `integrations` (the actual foundation layer)
**Ask First:** yes — this touches `communication_channels`' internal types and (if Option B is chosen) moves a file with an existing external consumer (`channel-gmail`).

---

## TLDR

Three OAuth2 provider integrations now exist or are being designed in this repo — Gmail (`channel-gmail`, shipped), Google Workspace (`.ai/specs/2026-03-29-google-workspace-integration.md`, draft), and Xero (`.ai/specs/2026-09-26-app-spec-xero-integration.md`, draft) — and all three converge on the same shape: an encrypted state-cookie CSRF flow, a form-urlencoded token exchange, and single-flight refresh coalescing for rotating refresh tokens. Two of the three low-level helpers that implement this (`communication_channels/lib/oauth-state.ts`, `lib/oauth-token.ts`) are **already provider-agnostic and already imported across a package boundary today** by `channel-gmail` — nothing to do there. The third, `lib/credential-refresh.ts`, is **not** reusable as-is: its public function signature is typed against `ChannelAdapter`, a large interface for chat/email/SMS channel providers that Xero (an accounting sync, not a communication channel) has no reason to implement.

**Proposed fix:** narrow `refreshCredentialsIfNeeded`'s `adapter` parameter from `ChannelAdapter` to a minimal structural type (`{ providerKey: string; refreshCredentials: (input) => Promise<RefreshedCredentials> }`) that any OAuth2 provider can satisfy without pulling in the channel-provider contract. No file move, no new module, no BC break — the function keeps its name, its behavior, and its existing callers keep compiling unchanged, because a `ChannelAdapter` already structurally satisfies the narrower type.

**Out of scope:** moving `oauth-state.ts`/`oauth-token.ts`/the narrowed `credential-refresh.ts` into `integrations` (the more architecturally "correct" home, since `communication_channels` is a vertical-specific hub, not the platform's OAuth foundation). Presented as Option B below and explicitly not recommended for now — the cost (file move + deprecation bridge + updating an existing consumer) isn't justified by two real consumers yet.

---

## Problem Statement

`packages/core/src/modules/communication_channels/lib/credential-refresh.ts` exports `refreshCredentialsIfNeeded`, which:
- No-ops when the adapter doesn't implement `refreshCredentials`.
- No-ops when the credential blob has no `expiresAt` and the caller doesn't force a refresh.
- **Coalesces concurrent refreshes for the same `channelId` onto one in-flight promise** — the actual reason this file exists: two concurrent sends on the same channel could otherwise both pass the expiry check and both call the provider's token endpoint, and with a rotating-refresh-token provider (Gmail, and Xero per its own App Spec § 0.1) the second exchange invalidates the first's token and flaps the connection into a reauth-required state.
- Resolves the OAuth client (`clientId`/`clientSecret`) via `resolveOAuthClientCredentials`, calls the refresh, and persists the result via an injected `CredentialsServiceLike`.

Its public signature is:

```typescript
export type RefreshCredentialsIfNeededInput = {
  adapter: ChannelAdapter   // <-- the coupling point
  channelId: string
  credentials: Record<string, unknown>
  scope: CredentialsScope
  refreshWindowMs?: number
  force?: boolean
}
```

`ChannelAdapter` (`communication_channels/lib/adapter.ts:540`) is a large interface — send/receive/webhook/health methods for chat, email, SMS, and push channel providers. A Xero (or QuickBooks, or HubSpot) sync adapter has no reason to implement any of that; it only needs the one method this helper actually calls, `refreshCredentials(input): Promise<RefreshedCredentials>`. As written, `sync_xero` cannot call `refreshCredentialsIfNeeded()` without either (a) implementing a dummy `ChannelAdapter` just to satisfy the type, which is exactly the kind of accidental coupling the platform's module-decoupling rules exist to prevent, or (b) reimplementing single-flight refresh coalescing from scratch, which is the duplicated-plumbing outcome this proposal exists to avoid.

This was surfaced, not invented, by the Xero App Spec's review process: the architect checkpoint on that spec confirmed `oauth-state.ts` and `oauth-token.ts` are already reusable (no action needed) but that `credential-refresh.ts` and the `ChannelAdapter`-typed route layer are not — narrowing the refresh helper's type is the one piece of that finding worth a real spec, since the route layer genuinely differs enough per provider (different consent-screen shapes, different multi-organisation-picker needs) that generalizing it is not obviously worth doing.

---

## Proposed Solution

### Option A — narrow the type in place (recommended)

Change `RefreshCredentialsIfNeededInput['adapter']` from `ChannelAdapter` to a new, minimal exported type:

```typescript
// communication_channels/lib/credential-refresh.ts
export interface RefreshableOAuthProvider {
  readonly providerKey: string
  refreshCredentials(input: {
    channelId: string
    credentials: Record<string, unknown>
    scope: TenantScope & { userId?: string | null }
    oauthClient?: OAuthClientConfig
  }): Promise<RefreshedCredentials>
}

export type RefreshCredentialsIfNeededInput = {
  adapter: RefreshableOAuthProvider   // was: ChannelAdapter
  // ...unchanged
}
```

`ChannelAdapter` already has a `providerKey: string` field and an optional `refreshCredentials` method with a compatible shape (checked structurally, not nominally, by TypeScript) — so every existing call site (`channel-gmail`, any other channel adapter) keeps compiling with **zero changes**, because a `ChannelAdapter` already satisfies `RefreshableOAuthProvider`. `sync_xero` (or any future OAuth2 provider) implements the four-line `RefreshableOAuthProvider` interface directly, with no channel-provider baggage, and calls the same `refreshCredentialsIfNeeded()` — importing it from `@open-mercato/core/modules/communication_channels/lib/credential-refresh`, the same way `channel-gmail` already imports `oauth-token.ts` from the same module today.

The one internal detail worth naming: `runRefresh()` calls `input.adapter.refreshCredentials.bind(input.adapter)` — binding still works identically on the narrower type, no change needed there.

**Cost:** one type signature change, one new exported interface, zero behavior change, zero migration for existing callers. `resolveOAuthClientCredentials` (in `lib/oauth-client-config.ts`) is untouched — it already takes a plain `providerKey: string`, not a `ChannelAdapter`.

**Where it lives:** stays in `communication_channels/lib/credential-refresh.ts`. `sync_xero` imports it as a workspace-package dependency on `@open-mercato/core`, exactly as `channel-gmail`'s `package.json` already declares. This is a slightly odd conceptual home (a "communication channels" module hosting a helper an accounting-sync integration imports) but it costs nothing to accept for now — see Option B for the alternative and why it's not recommended yet.

### Option B — move the toolkit into `integrations` (not recommended now)

Move `oauth-state.ts`, `oauth-token.ts`, and the narrowed `credential-refresh.ts` into `packages/core/src/modules/integrations/lib/oauth/`, since `integrations` is the platform's actual foundation layer for "all external connectors" (its own AGENTS.md's opening line), whereas `communication_channels` is one vertical hub among several (alongside `payment_gateways`, `shipping_carriers`, `data_sync`). This is the architecturally cleaner home and the one a developer would intuitively look for first.

**Cost, and why it's not worth paying yet:** a real file move requires (1) a deprecation bridge per `BACKWARD_COMPATIBILITY.md` — re-export the old `communication_channels/lib/*` paths for at least one minor version, since `channel-gmail` already imports the old path in production; (2) updating `channel-gmail`'s import; (3) updating both modules' AGENTS.md; (4) a decision on whether `oauth-state.ts`'s reference to the SSO module's state-cookie helper (it's explicitly a from-scratch re-implementation, not an import, per its own file header, because `core` cannot import `enterprise`) needs re-documenting in the new location. None of this is hard, but none of it is justified yet either — there are exactly two real, shipped-or-drafted consumers (Gmail, and Xero once it's built), and the move doesn't unblock anything Option A doesn't already unblock. Revisit this if a third OAuth2 provider (or a platform-level request for a documented "how do I add OAuth to my integration" guide) makes the current home actively confusing.

---

## Architecture

```
communication_channels/lib/
├── oauth-state.ts        (unchanged — already provider-agnostic, already imported by channel-gmail)
├── oauth-token.ts         (unchanged — already provider-agnostic, already imported by channel-gmail)
└── credential-refresh.ts  (adapter: ChannelAdapter -> adapter: RefreshableOAuthProvider)
                                                        ^
                                                        structurally satisfied by ChannelAdapter (no
                                                        existing caller changes) AND by any narrow
                                                        OAuth2 provider (sync_xero, future providers)

sync_xero/lib/
└── oauth.ts               (NEW, per the Xero App Spec) — imports requestOAuthToken, tokenResponseToExpiresAt,
                            createOAuthState/verifyOAuthState/decryptOAuthState, and
                            refreshCredentialsIfNeeded, all from communication_channels' lib/,
                            same pattern channel-gmail already uses
```

No new module, no new package, no new database entity.

---

## Data Models

None — this is a type-signature change on an existing in-memory helper function. No schema, no migration.

---

## API Contracts

None — `refreshCredentialsIfNeeded` is an internal server-side function, not an HTTP route. Its exported TypeScript type changes (additively — see below), nothing else.

---

## Migration & Backward Compatibility

| Surface | Classification | Note |
|---|---|---|
| `RefreshCredentialsIfNeededInput.adapter` type | **ADDITIVE / WIDENING** (a narrower required type is a widening change for callers — anything satisfying the old, more specific type still satisfies the new, more general one) | Every existing caller (`channel-gmail`) keeps compiling unchanged; `ChannelAdapter` structurally satisfies `RefreshableOAuthProvider` |
| New export `RefreshableOAuthProvider` | ADDITIVE | New named export, nothing removed |
| Import paths | UNCHANGED (Option A) | No file moves |
| `credential-refresh.ts` behavior | UNCHANGED | Same coalescing logic, same persistence path, same function name |

Option A has **zero** backward-compatibility risk — this is purely a type-signature widening, the one direction of change that can never break an existing caller.

---

## Risks & Impact Review

#### Risk: A future `ChannelAdapter` change accidentally narrows its own `refreshCredentials` signature below what `RefreshableOAuthProvider` requires
- **Scenario:** Someone editing `communication_channels/lib/adapter.ts` changes `ChannelAdapter.refreshCredentials`'s signature in a way that no longer structurally satisfies `RefreshableOAuthProvider`, breaking the (now implicit) contract between the two interfaces without either interface naming the other.
- **Severity:** Low.
- **Affected area:** `communication_channels`, any OAuth2 provider using `refreshCredentialsIfNeeded`.
- **Mitigation:** TypeScript's structural typing means this fails at compile time on the very next `yarn build`, in the module that made the change — not a silent runtime failure. A one-line comment on `ChannelAdapter.refreshCredentials` noting "must stay structurally compatible with `RefreshableOAuthProvider` in `credential-refresh.ts`" closes the loop for a human reader.
- **Residual risk:** Negligible — this is a compile-time-caught class of error.

#### Risk: `sync_xero` importing from `communication_channels` reads as a confusing dependency to a future maintainer
- **Scenario:** Someone reading `sync_xero`'s `package.json`/imports wonders why an accounting integration depends on a module named for chat/email/SMS channels.
- **Severity:** Low.
- **Affected area:** Developer experience / discoverability.
- **Mitigation:** A one-line comment at the `sync_xero` import site pointing at this spec explains the "why." This is the accepted cost of Option A over Option B (§ Proposed Solution).
- **Residual risk:** Low, cosmetic — revisit via Option B if it becomes a repeated point of confusion.

---

## Final Compliance Report

### AGENTS.md files reviewed
- Root `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/communication_channels/` (no dedicated AGENTS.md found; reviewed the module's actual source instead)
- `packages/core/src/modules/integrations/AGENTS.md`

### Compliance Matrix

| Rule | Status | Notes |
|---|---|---|
| No direct ORM relationships between modules | N/A | No entities involved |
| Ask before changing contract surfaces | ✅ Flagged | This document IS the ask — status is "Proposed," not implemented |
| BC: additive/widening type changes only | ✅ PASS | Structural widening, verified against `ChannelAdapter`'s actual shape |
| No provider-specific logic added to a generic module | ✅ PASS | `credential-refresh.ts` stays generic; provider-specific refresh logic (Xero's own token endpoint call) stays in `sync_xero` |

### Verdict

**Ready for maintainer review** — spec-only, no code changes proposed to land without explicit sign-off on Option A vs. Option B (and confirmation Option A is acceptable at all) from whoever owns `communication_channels`.

---

## Changelog

### 2026-09-26
- Initial draft, raised as a follow-up from the Xero App Spec's architect checkpoint, which found the OAuth-reuse question worth separating from that spec (which only needs `credential-refresh.ts`'s type narrowed, not a platform-wide OAuth module built). Not yet implemented.
