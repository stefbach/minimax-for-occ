import Link from "next/link";
import { listPersonas } from "@/lib/personas/loader";
import { PersonaLibraryClient } from "@/components/personas/PersonaLibraryClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bibliothèque persona — Axon",
  description:
    "Marketplace de personas vocaux prêts à cloner dans votre organisation.",
};

export default async function PersonaLibraryPage() {
  const personas = await listPersonas();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Bibliothèque persona</h1>
          <div className="subtitle">
            {personas.length} modèle{personas.length === 1 ? "" : "s"} prêt
            {personas.length === 1 ? "" : "s"} à cloner dans votre organisation
          </div>
        </div>
        <Link href="/agents">
          <button className="ghost">← Mes agents</button>
        </Link>
      </div>

      <PersonaLibraryClient initial={personas} />
    </>
  );
}
