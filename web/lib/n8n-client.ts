/**
 * Thin re-export wrapper around web/lib/n8n.ts plus an optional JWT signing
 * helper if N8N_JWT_SECRET is configured.
 *
 * Kept as a separate file so other modules (Copilot tools, future MCP servers)
 * can import "n8n-client" without having to know about the legacy paths used
 * by the workflow templates UI.
 */
import crypto from "node:crypto";

export {
  listN8nWorkflows,
  getN8nWorkflow,
  createN8nWorkflow,
  updateN8nWorkflow,
  activateN8nWorkflow,
  triggerN8nWebhook,
} from "./n8n";

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Sign a short-lived HS256 JWT against `N8N_JWT_SECRET`. Used by deployments
 * that front n8n with an auth proxy expecting a Bearer token instead of the
 * static `X-N8N-API-KEY`. Falls back to throwing if secret is missing.
 */
export function signN8nJwt(payload: Record<string, unknown>, ttlSec = 300): string {
  const secret = process.env.N8N_JWT_SECRET;
  if (!secret) throw new Error("N8N_JWT_SECRET missing");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec }),
  );
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}
