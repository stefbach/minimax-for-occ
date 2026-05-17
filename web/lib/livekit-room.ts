import { RoomServiceClient } from "livekit-server-sdk";

let client: RoomServiceClient | null = null;

/**
 * Lazy-built LiveKit RoomServiceClient. Uses the same env vars as the
 * AccessToken-minting routes. Returns null if the server isn't configured
 * — callers should treat that as a soft failure (log + best-effort).
 */
export function roomService(): RoomServiceClient | null {
  if (client) return client;
  const url = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  // RoomServiceClient expects an HTTP(S) URL — LiveKit's public URL is wss://
  const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  client = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  return client;
}

/**
 * Merge a JSON patch into the room's metadata. If the room doesn't exist
 * or LiveKit is unreachable, returns false so callers can still proceed
 * with their DB-side work (the worker will catch up via Supabase realtime).
 */
export async function patchRoomMetadata(
  room: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const svc = roomService();
  if (!svc) return false;
  try {
    let current: Record<string, unknown> = {};
    try {
      const rooms = await svc.listRooms([room]);
      const existing = rooms[0];
      if (existing?.metadata) {
        try {
          current = JSON.parse(existing.metadata) as Record<string, unknown>;
        } catch {
          current = {};
        }
      }
    } catch {
      // listRooms failed (e.g. room not yet created) — fall through and just
      // write the patch as the new metadata.
    }
    const merged = { ...current, ...patch };
    await svc.updateRoomMetadata(room, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}
