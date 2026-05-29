import { SipClient } from "livekit-server-sdk";

/**
 * On dialer startup: log the real config of the LiveKit outbound trunk, and —
 * if LIVEKIT_OUTBOUND_AUTH_USERNAME/PASSWORD are set — enforce that auth on the
 * trunk via the API. This removes any doubt about whether the console "Update"
 * actually persisted the SIP digest credentials Twilio expects, which is the
 * usual cause of a 403 Forbidden on the outbound INVITE.
 */
export async function ensureOutboundTrunkAuth(): Promise<void> {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const trunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID;
  if (!url || !key || !secret || !trunkId) {
    console.log("[livekit-trunk] skipped — LiveKit / outbound trunk env not fully set");
    return;
  }
  const host = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const sip = new SipClient(host, key, secret);

  try {
    const trunks = await sip.listSipOutboundTrunk();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = trunks.find((x: any) => x.sipTrunkId === trunkId) as any;
    if (!t) {
      console.error(`[livekit-trunk] outbound trunk ${trunkId} NOT FOUND in this project`);
    } else {
      console.log(
        `[livekit-trunk] current: id=${t.sipTrunkId} name=${t.name} address=${t.address} ` +
          `numbers=${JSON.stringify(t.numbers ?? [])} authUsername=${t.authUsername || "(empty)"} ` +
          `transport=${t.transport}`,
      );
    }
  } catch (e) {
    console.error("[livekit-trunk] list failed:", (e as Error).message);
  }

  const authUser = process.env.LIVEKIT_OUTBOUND_AUTH_USERNAME;
  const authPass = process.env.LIVEKIT_OUTBOUND_AUTH_PASSWORD;
  if (authUser && authPass) {
    try {
      await sip.updateSipOutboundTrunkFields(trunkId, {
        authUsername: authUser,
        authPassword: authPass,
      });
      console.log(
        `[livekit-trunk] enforced auth on ${trunkId}: authUsername=${authUser} ` +
          `(password set, ${authPass.length} chars)`,
      );
    } catch (e) {
      console.error("[livekit-trunk] enforce auth failed:", (e as Error).message);
    }
  } else {
    console.log(
      "[livekit-trunk] LIVEKIT_OUTBOUND_AUTH_USERNAME/PASSWORD not set — " +
        "skipping auth enforcement (set them to guarantee the SIP credentials match Twilio)",
    );
  }
}
