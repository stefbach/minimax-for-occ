import { NextResponse } from "next/server";
import {
  hasTwilio,
  searchAvailableNumbers,
  TwilioApiError,
  TwilioConfigError,
} from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasTwilio()) {
    return NextResponse.json(
      {
        error:
          "Twilio non configuré : définissez TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN dans les variables d'environnement Vercel.",
      },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const country = (searchParams.get("country") ?? "FR").toUpperCase();
  const typeRaw = searchParams.get("type") ?? "local";
  const type: "local" | "mobile" | "tollfree" =
    typeRaw === "mobile" || typeRaw === "tollfree" ? typeRaw : "local";
  const areaCode = searchParams.get("areaCode") ?? undefined;

  try {
    const data = await searchAvailableNumbers({ country, type, areaCode });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof TwilioConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    if (err instanceof TwilioApiError) {
      return NextResponse.json(
        { error: `Twilio: ${err.message}`, code: err.twilioCode },
        { status: err.status >= 400 && err.status < 600 ? err.status : 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Twilio inconnue" },
      { status: 500 },
    );
  }
}
