import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Placeholder for the English edition of the marketing homepage. The original
// axon-ai.tech site ships an en/ variant; porting its copy is a fast follow.
// Until then, /en falls back to the French homepage so the FR/EN switch never
// dead-ends on a 404.
export default function EnglishHome() {
  redirect("/");
}
