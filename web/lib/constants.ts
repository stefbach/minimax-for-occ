/**
 * Shared constants for the web app.
 */

/**
 * UUID of the historical "Legacy" organization, seeded in the very first
 * migration before multi-tenant support landed. Kept as a fallback so that
 * routes called before authentication (server-side jobs, first deploy,
 * webhooks…) still resolve to a valid tenant row.
 *
 * New code should NEVER hardcode this UUID — import the constant instead.
 * Authenticated routes should always derive the org from the user's session
 * (see `web/lib/request-context.ts`).
 */
export const LEGACY_ORG_ID = "00000000-0000-0000-0000-000000000001";
