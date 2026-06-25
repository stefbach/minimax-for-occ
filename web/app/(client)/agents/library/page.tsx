import Link from "next/link";
import { listPersonas } from "@/lib/personas/loader";
import { PersonaLibraryClient } from "@/components/personas/PersonaLibraryClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Persona library — Axon",
  description:
    "Marketplace of voice personas ready to clone into your organisation.",
};

export default async function PersonaLibraryPage() {
  const personas = await listPersonas();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Persona library</h1>
          <div className="subtitle">
            {personas.length} template{personas.length === 1 ? "" : "s"} ready to clone into your organisation
          </div>
        </div>
        <Link href="/agents">
          <button className="ghost">← My agents</button>
        </Link>
      </div>

      <PersonaLibraryClient initial={personas} />
    </>
  );
}
