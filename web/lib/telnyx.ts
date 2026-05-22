/**
 * Server-side helper for the Telnyx REST API v2.
 *
 * Reads credentials from env vars:
 *   TELNYX_API_KEY           — starts with "KEY_..."
 *   TELNYX_CONNECTION_ID     — SIP Connection ID for inbound routing
 *   TELNYX_OUTBOUND_PROFILE  — Outbound Voice Profile ID for outbound calls
 *
 * All requests hit https://api.telnyx.com/v2/...
 * with Bearer token auth.
 */

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export interface TelnyxAvailableNumber {
  phoneNumber: string;
  isoCountry: string;
  locality: string | null;
  region: string | null;
  capabilities: { voice: boolean; sms: boolean; fax: boolean };
}

export interface TelnyxPhoneNumber {
  id: string;
  phoneNumber: string;
  status: string;
  connectionId: string | null;
  capabilities: { voice: boolean; sms: boolean; fax: boolean };
}

export class TelnyxConfigError extends Error {
  constructor() {
    super(
      "Telnyx non configuré : définissez TELNYX_API_KEY dans les variables d'environnement Vercel.",
    );
    this.name = "TelnyxConfigError";
  }
}

export class TelnyxApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TelnyxApiError";
    this.status = status;
  }
}

export function hasTelnyx(): boolean {
  return Boolean(process.env.TELNYX_API_KEY);
}

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new TelnyxConfigError();
  return key;
}

async function telnyxFetch(
  path: string,
  init: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | undefined>;
  } = {},
): Promise<any> {
  const apiKey = getApiKey();
  const url = new URL(`${TELNYX_API_BASE}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (init.body) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave json null */
  }
  if (!res.ok) {
    const msg =
      json?.errors?.[0]?.detail ??
      json?.errors?.[0]?.title ??
      text ??
      `Telnyx HTTP ${res.status}`;
    throw new TelnyxApiError(msg, res.status);
  }
  return json;
}

/**
 * Search Telnyx for available phone numbers to purchase.
 * country: ISO-2 country code (FR, GB, US, ...)
 * type:    'local' | 'mobile' | 'toll_free' (default 'local')
 */
export async function searchAvailableNumbers(opts: {
  country: string;
  type?: "local" | "mobile" | "toll_free";
}): Promise<TelnyxAvailableNumber[]> {
  const country = opts.country.toUpperCase();
  const query: Record<string, string> = {
    "filter[country_code]": country,
    "filter[features][]": "voice",
    "filter[limit]": "20",
  };
  if (opts.type === "toll_free") query["filter[number_type]"] = "toll-free";
  else if (opts.type === "mobile") query["filter[number_type]"] = "mobile";

  const res = await telnyxFetch("/available_phone_numbers", { query });
  const arr: any[] = res?.data ?? [];
  return arr.map((n) => ({
    phoneNumber: n.phone_number,
    isoCountry: n.country_code ?? country,
    locality: n.city ?? null,
    region: n.region_information?.[0]?.region_name ?? null,
    capabilities: {
      voice: n.features?.some((f: any) => f.name === "voice") ?? false,
      sms: n.features?.some((f: any) => f.name === "sms") ?? false,
      fax: n.features?.some((f: any) => f.name === "fax") ?? false,
    },
  }));
}

/**
 * Purchase a Telnyx number and optionally assign it to a SIP connection.
 */
export async function purchaseNumber(opts: {
  phoneNumber: string;
  connectionId?: string;
}): Promise<TelnyxPhoneNumber> {
  const body: Record<string, unknown> = { phone_number: opts.phoneNumber };
  if (opts.connectionId) body.connection_id = opts.connectionId;

  const res = await telnyxFetch("/phone_numbers", { method: "POST", body });
  return mapPhoneNumber(res?.data ?? res);
}

/**
 * Assign an already-owned number to a SIP connection (wires it for inbound).
 */
export async function configureNumberConnection(
  numberId: string,
  connectionId: string,
): Promise<TelnyxPhoneNumber> {
  const res = await telnyxFetch(`/phone_numbers/${encodeURIComponent(numberId)}`, {
    method: "PATCH",
    body: { connection_id: connectionId },
  });
  return mapPhoneNumber(res?.data ?? res);
}

/**
 * Release (delete) a Telnyx number. Idempotent: a 404 is swallowed.
 */
export async function releaseNumber(numberId: string): Promise<void> {
  try {
    await telnyxFetch(`/phone_numbers/${encodeURIComponent(numberId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof TelnyxApiError && err.status === 404) return;
    throw err;
  }
}

/**
 * Fetch a single number by its Telnyx ID.
 */
export async function getPhoneNumber(
  numberId: string,
): Promise<TelnyxPhoneNumber | null> {
  try {
    const res = await telnyxFetch(`/phone_numbers/${encodeURIComponent(numberId)}`);
    return mapPhoneNumber(res?.data ?? res);
  } catch (err) {
    if (err instanceof TelnyxApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Find an owned number by E.164. Returns null if not found.
 */
export async function findNumberByE164(
  e164: string,
): Promise<TelnyxPhoneNumber | null> {
  const res = await telnyxFetch("/phone_numbers", {
    query: { "filter[phone_number]": e164 },
  });
  const arr: any[] = res?.data ?? [];
  if (arr.length === 0) return null;
  return mapPhoneNumber(arr[0]);
}

/**
 * Place an outbound call via Telnyx Call Control API.
 * Telnyx bridges the call and sends events to the webhook_url.
 */
export async function createCall(opts: {
  to: string;
  from: string;
  webhookUrl: string;
  connectionId: string;
  answeredByEnabled?: boolean;
  timeoutSecs?: number;
}): Promise<{ callControlId: string; callLegId: string }> {
  const body: Record<string, unknown> = {
    to: opts.to,
    from: opts.from,
    connection_id: opts.connectionId,
    webhook_url: opts.webhookUrl,
    answering_machine_detection: opts.answeredByEnabled ? "detect" : "disabled",
  };
  if (opts.timeoutSecs !== undefined) body.timeout_secs = opts.timeoutSecs;

  const res = await telnyxFetch("/calls", { method: "POST", body });
  return {
    callControlId: res?.data?.call_control_id ?? "",
    callLegId: res?.data?.call_leg_id ?? "",
  };
}

function mapPhoneNumber(n: any): TelnyxPhoneNumber {
  return {
    id: n.id,
    phoneNumber: n.phone_number,
    status: n.status ?? "active",
    connectionId: n.connection_id ?? null,
    capabilities: {
      voice: n.features?.some((f: any) => f.name === "voice") ?? true,
      sms: n.features?.some((f: any) => f.name === "sms") ?? false,
      fax: n.features?.some((f: any) => f.name === "fax") ?? false,
    },
  };
}

/**
 * Build the public webhook URL that Telnyx should hit for inbound calls.
 */
export function defaultWebhookUrl(originFromRequest?: string): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "") + "/api/telnyx-voice";
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}/api/telnyx-voice`;
  if (originFromRequest) return originFromRequest.replace(/\/+$/, "") + "/api/telnyx-voice";
  return "https://example.com/api/telnyx-voice";
}
