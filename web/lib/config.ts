/**
 * Centralised env-var config (lazy).
 *
 * Why lazy?  Calling `mustEnv()` at module-load time would crash `next build`
 * (where most env vars are unset) and any Vercel preview that doesn't have the
 * full secret set. Instead the `cfg` object is built behind getter properties
 * — env vars are only read on first access.
 *
 * Usage:
 *   import { cfg } from "@/lib/config";
 *   const url = cfg.supabase.url;             // throws if missing
 *   const key = cfg.openai.apiKey;            // string | undefined
 *
 * Required vs. optional:
 *   - mustEnv()  → throws on first access if missing (call sites assume present)
 *   - optEnv()   → returns string | undefined
 *
 * Add a new var here whenever you reach for `process.env.XYZ` in two places.
 * See docs/ENV_VARS.md for the full inventory.
 */

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

export interface AppConfig {
  supabase: {
    /** Required. Service-side URL (server). Throws if missing. */
    readonly url: string;
    /** Required. Service-role key (server-only). Throws if missing. */
    readonly serviceRole: string;
    /** Optional. Anon key for browser/SSR clients. */
    readonly anonKey: string | undefined;
    /** Optional. NEXT_PUBLIC_SUPABASE_URL fallback for browser bundles. */
    readonly publicUrl: string | undefined;
  };
  openai: {
    readonly apiKey: string | undefined;
  };
  twilio: {
    readonly sid: string | undefined;
    readonly authToken: string | undefined;
  };
  livekit: {
    readonly url: string | undefined;
    readonly apiKey: string | undefined;
    readonly apiSecret: string | undefined;
  };
  minimax: {
    readonly apiKey: string | undefined;
    readonly groupId: string | undefined;
    /** Optional with a sensible default. */
    readonly baseUrl: string;
  };
  app: {
    /** APP_URL → NEXT_PUBLIC_APP_URL → ''. Never throws. */
    readonly url: string;
    readonly sharedToken: string | undefined;
  };
}

/**
 * Lazily-evaluated config. All getters defer process.env access so importing
 * this module from `next build` or unit tests never crashes.
 */
export const cfg: AppConfig = {
  supabase: {
    get url() {
      return mustEnv("SUPABASE_URL");
    },
    get serviceRole() {
      return mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    },
    get anonKey() {
      return optEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    },
    get publicUrl() {
      return optEnv("NEXT_PUBLIC_SUPABASE_URL");
    },
  },
  openai: {
    get apiKey() {
      return optEnv("OPENAI_API_KEY");
    },
  },
  twilio: {
    get sid() {
      return optEnv("TWILIO_ACCOUNT_SID");
    },
    get authToken() {
      return optEnv("TWILIO_AUTH_TOKEN");
    },
  },
  livekit: {
    get url() {
      return optEnv("LIVEKIT_URL");
    },
    get apiKey() {
      return optEnv("LIVEKIT_API_KEY");
    },
    get apiSecret() {
      return optEnv("LIVEKIT_API_SECRET");
    },
  },
  minimax: {
    get apiKey() {
      return optEnv("MINIMAX_API_KEY");
    },
    get groupId() {
      return optEnv("MINIMAX_GROUP_ID");
    },
    get baseUrl() {
      // Historical default in web/lib/minimax.ts; keep the /v1 suffix.
      return optEnv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")!;
    },
  },
  app: {
    get url() {
      return optEnv("APP_URL") ?? optEnv("NEXT_PUBLIC_APP_URL") ?? "";
    },
    get sharedToken() {
      return optEnv("APP_SHARED_TOKEN");
    },
  },
};

/**
 * Function-style accessor — handy in places where a `cfg` import would create
 * a circular reference (e.g. inside very early-loaded modules).
 */
export function getConfig(): AppConfig {
  return cfg;
}

// Re-exported for tests / scripts that need to assert on env presence.
export { mustEnv, optEnv };
