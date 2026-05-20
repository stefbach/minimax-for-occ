# Request context & org resolution

Sprint 6 centralises the way API route handlers resolve **who is calling**
and **which organisation they're acting on**. Two helpers in `web/lib/`
cover the existing call sites, and one new helper (`requireContext`) gives
new code a stricter contract.

## TL;DR

| Helper | Module | Behaviour |
|---|---|---|
| `requestOrgId(req)` | `web/lib/request-org.ts` | Returns an `orgId` string. Lenient — falls back to `LEGACY_ORG_ID` for unauthenticated callers (webhooks, server jobs). |
| `requestContext(req)` | `web/lib/request-org.ts` | Same as above plus `user_id` + `role` + `is_super_admin`. Lenient. |
| `requireContext(req, opts)` | `web/lib/request-context.ts` | Strict: throws `HttpError(401)` if no user, `HttpError(403)` if no role in the resolved org. Returns `{ userId, orgId, role, isSuper }`. |

`LEGACY_ORG_ID` lives in `web/lib/constants.ts`. **Never hardcode the UUID
`00000000-0000-0000-0000-000000000001`** anywhere else.

## Resolution order

All three helpers apply the same priority:

1. **The `axon.org_id` cookie** (set by `POST /api/orgs/switch`) — wins if
   the user has a membership in that org or is `super_admin`.
2. **`?org_id=` query param** — honoured **only** if the caller is
   `super_admin`. For everyone else the param is *ignored* and a warning is
   logged. `requireContext` ignores it entirely unless the caller passes
   `allowOrgQueryParam: true`.
3. **The user's primary membership** (oldest by `created_at`).
4. **`LEGACY_ORG_ID`** — only for unauthenticated callers (webhooks).

This protects every route from accidental cross-tenant reads even when RLS
isn't perfectly tight. The cookie-based switch keeps the existing UX for
end users; the query param is reserved for super-admin impersonation.

## When to use which

* **New authenticated routes** → `requireContext(req)`. The 401/403 errors
  are explicit and you get `userId` + `role` for free.
* **Existing routes that should keep their lenient behaviour** (call
  webhooks, public widgets, server jobs) → keep `requestOrgId(req)`.
* **Routes that need `is_super_admin` for fine-grained gating** →
  `requestContext(req)`.

## Behaviour matrix (manual verification checklist)

Until vitest is wired up, this is the smoke-test we run by hand whenever
the helpers change. Each row is a curl against a dev server with a
specific cookie + query combination.

| # | Auth state | Cookie | `?org_id=` | Expected `requireContext` outcome |
|---|---|---|---|---|
| 1 | not logged in | — | — | `HttpError(401)` |
| 2 | not logged in | — | `?org_id=X` | `HttpError(401)` |
| 3 | user in org A | — | — | resolves to A |
| 4 | user in org A | cookie=A | — | resolves to A |
| 5 | user in org A | cookie=B (no membership) | — | resolves to A (cookie ignored) |
| 6 | user in org A | — | `?org_id=B` | resolves to A, **warning logged** |
| 7 | user in org A | — | `?org_id=B` + `allowOrgQueryParam:true` | resolves to A (still — non-super) |
| 8 | super_admin | — | `?org_id=B` + `allowOrgQueryParam:true` | resolves to B |
| 9 | super_admin | cookie=A | `?org_id=B` + `allowOrgQueryParam:true` | resolves to B (query wins over cookie when explicitly allowed) |
| 10 | logged in, zero memberships | — | — | `HttpError(403)` |

For `requestOrgId`/`requestContext` the same rows apply except #1, #2 and
#10 don't throw — they return `LEGACY_ORG_ID` for backward compat with
unauthenticated webhook callers.
