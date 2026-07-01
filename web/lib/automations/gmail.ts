/**
 * Gmail integration for the OCC automations (OAuth2 refresh-token flow over
 * fetch — no googleapis dependency). Covers what the n8n flows used:
 *   • search an inbox by query, with attachments
 *   • download attachment bytes
 *   • send an email (optionally with attachments)
 *   • create a draft (the NHS submission + clinic-signature drafts)
 *
 * Credential (kind 'gmail_oauth'): { client_id, client_secret, refresh_token,
 * sender? }. One credential per mailbox (Stormi, Customer Service, Dr Nedelcu).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailCred {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  sender?: string;
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  /** standard base64 (not base64url). */
  data: string;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

function b64urlToB64(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

async function accessToken(cred: GmailCred): Promise<string> {
  const rt = cred.refresh_token ?? "";
  if (!rt || !cred.client_id || !cred.client_secret) {
    throw new Error("gmail credential missing client_id/client_secret/refresh_token");
  }
  const cached = tokenCache.get(rt);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const body = new URLSearchParams({
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    refresh_token: rt,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  tokenCache.set(rt, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

/** Search message ids matching a Gmail query (e.g. "from:a@b.com OR from:c@d.com"). */
export async function searchMessages(cred: GmailCred, q: string, max = 25): Promise<string[]> {
  const token = await accessToken(cred);
  const url = `${API}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`gmail search ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { messages?: Array<{ id: string }> };
  return (j.messages ?? []).map((m) => m.id);
}

interface MessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string };
  parts?: MessagePart[];
}

function walkParts(part: MessagePart | undefined, out: MessagePart[]): void {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const p of part.parts ?? []) walkParts(p, out);
}

/** Download every attachment on a message (skips inline parts with no filename). */
export async function getMessageAttachments(cred: GmailCred, messageId: string): Promise<GmailAttachment[]> {
  const token = await accessToken(cred);
  const r = await fetch(`${API}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`gmail get ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { payload?: MessagePart };
  const parts: MessagePart[] = [];
  walkParts(j.payload, parts);
  const out: GmailAttachment[] = [];
  for (const p of parts) {
    const attId = p.body?.attachmentId;
    if (!attId) continue;
    const ar = await fetch(`${API}/messages/${messageId}/attachments/${attId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!ar.ok) continue;
    const aj = (await ar.json()) as { data?: string };
    if (!aj.data) continue;
    out.push({
      filename: p.filename ?? "attachment",
      mimeType: p.mimeType ?? "application/octet-stream",
      data: b64urlToB64(aj.data),
    });
  }
  return out;
}

export interface GmailMessageDetails {
  id: string;
  subject: string;
  from: string;
  /** ms since epoch, from Gmail's internalDate. */
  internalDateMs: number;
  textBody: string;
}

function walkBodyText(part: MessagePart | undefined, out: { text?: string; html?: string }): void {
  if (!part) return;
  const data = part.body?.data;
  if (part.mimeType === "text/plain" && data && !out.text) {
    out.text = Buffer.from(b64urlToB64(data), "base64").toString("utf8");
  }
  if (part.mimeType === "text/html" && data && !out.html) {
    out.html = Buffer.from(b64urlToB64(data), "base64").toString("utf8");
  }
  for (const p of part.parts ?? []) walkBodyText(p, out);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch subject/sender/date + plain-text body of a message (no attachments). */
export async function getMessageDetails(cred: GmailCred, messageId: string): Promise<GmailMessageDetails> {
  const token = await accessToken(cred);
  const r = await fetch(`${API}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`gmail get ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as {
    payload?: MessagePart & { headers?: Array<{ name: string; value: string }> };
    internalDate?: string;
  };
  const headers = j.payload?.headers ?? [];
  const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const bodyOut: { text?: string; html?: string } = {};
  walkBodyText(j.payload, bodyOut);
  const textBody = bodyOut.text || (bodyOut.html ? stripHtml(bodyOut.html) : "");
  return {
    id: messageId,
    subject: h("Subject"),
    from: h("From"),
    internalDateMs: Number(j.internalDate ?? 0) || Date.now(),
    textBody: textBody.slice(0, 8000),
  };
}

/**
 * RFC 2047 "encoded-word" for header values (e.g. a subject containing an
 * em dash or accents). Pure-ASCII values pass through unchanged. Non-ASCII
 * values are emitted as one or more =?UTF-8?B?...?= words, each kept ≤ 75
 * chars and split on character boundaries so multi-byte UTF-8 sequences are
 * never broken across words.
 */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const prefix = "=?UTF-8?B?";
  const suffix = "?=";
  const maxB64 = 75 - prefix.length - suffix.length;
  const words: string[] = [];
  let chunk = "";
  const flush = () => {
    if (chunk) words.push(prefix + Buffer.from(chunk, "utf8").toString("base64") + suffix);
    chunk = "";
  };
  for (const ch of value) {
    const candidate = chunk + ch;
    if (Buffer.from(candidate, "utf8").toString("base64").length > maxB64) {
      flush();
      chunk = ch;
    } else {
      chunk = candidate;
    }
  }
  flush();
  return words.join("\r\n ");
}

function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: GmailAttachment[];
}): string {
  const boundary = `occ_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (opts.attachments && opts.attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", opts.html, "");
    for (const a of opts.attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        a.data.replace(/(.{76})/g, "$1\n"),
        "",
      );
    }
    lines.push(`--${boundary}--`, "");
  } else {
    lines.push("Content-Type: text/html; charset=UTF-8", "", opts.html);
  }
  return lines.join("\r\n");
}

function toRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Send an email from this mailbox. */
export async function sendEmail(cred: GmailCred, opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: GmailAttachment[];
}): Promise<void> {
  const token = await accessToken(cred);
  const raw = toRaw(buildMime({ from: cred.sender ?? "me", ...opts }));
  const r = await fetch(`${API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** Create a draft (reviewed/sent by a human) in this mailbox. */
export async function createDraft(cred: GmailCred, opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: GmailAttachment[];
}): Promise<void> {
  const token = await accessToken(cred);
  const raw = toRaw(buildMime({ from: cred.sender ?? "me", ...opts }));
  const r = await fetch(`${API}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`gmail draft ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
