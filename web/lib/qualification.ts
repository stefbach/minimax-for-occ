// Centralised mapping from free-text qualification / disposition values
// (whatever the AI agent or human operator typed) to the 9 fixed buckets
// used across the OCC dashboard. Keep all variants here so the dashboard,
// CRM filters and exports stay consistent.

export type QualBucket =
  | "rdv_confirme"
  | "passer_humain"
  | "rappel"
  | "pas_interesse"
  | "pas_de_reponse"
  | "repondeur"
  | "faux_numero"
  | "non_eligible"
  | "ne_pas_rappeler"
  | "suivi_requis"
  | "autre";

export const QUAL_BUCKETS: { key: QualBucket; label: string }[] = [
  { key: "rdv_confirme", label: "RDV CONFIRME" },
  { key: "passer_humain", label: "À PASSER À L'HUMAIN" },
  { key: "rappel", label: "RAPPEL" },
  { key: "pas_interesse", label: "PAS INTERESSE" },
  { key: "pas_de_reponse", label: "PAS DE REPONSE" },
  { key: "repondeur", label: "REPONDEUR" },
  { key: "faux_numero", label: "FAUX NUMERO" },
  { key: "non_eligible", label: "NON ELIGIBLE" },
  { key: "ne_pas_rappeler", label: "NE PAS RAPPELER" },
  { key: "suivi_requis", label: "SUIVI REQUIS" },
];

export function normalizeQualification(raw: string | null | undefined): QualBucket {
  if (!raw) return "autre";
  const s = raw.toLowerCase().trim();
  if (!s || s === "—") return "autre";
  // Order matters: more specific patterns first.
  if (/(ne[\s_-]*pas[\s_-]*rappel|do[\s_-]*not[\s_-]*call|dnc)/.test(s)) return "ne_pas_rappeler";
  if (/(non[\s_-]*éligible|non[\s_-]*eligible|ineligib|not[\s_-]*eligib)/.test(s)) return "non_eligible";
  if (/(faux[\s_-]*num|wrong[\s_-]*number|invalid[\s_-]*number|bad[\s_-]*number)/.test(s)) return "faux_numero";
  if (/(rdv|rendez|appointment|booked|confirm)/.test(s)) return "rdv_confirme";
  // OCC's canonical label is "A PASSER A L'HUMAIN" (no accent on either A).
  // The earlier pattern required à (accented) inside the optional 'à l''
  // group, so "a passer a l'humain" silently fell through to 'autre' and
  // the dashboard's À PASSER À L'HUMAIN bucket stayed at 0 even after the
  // transfer_to_human tool fired. Accept both [àa] and tolerate the space
  // between the apostrophe and 'humain' that real text carries.
  if (/(passer[\s_-]*(?:[àa][\s_-]*l['''][\s_-]*)?humain|to[\s_-]*human|human[\s_-]*callback|escalat)/.test(s)) return "passer_humain";
  // Reached agent 2/3 (Isabelle/Victoria) without booking — warm lead, human
  // follow-up required. Must precede the generic rappel/follow-up rule below.
  if (/(suivi[\s_-]*requis|suivi|reached[\s_-]*specialist|follow[\s_-]*up[\s_-]*required)/.test(s)) return "suivi_requis";
  if (/(rappel|callback|call[\s_-]*back|follow[\s_-]*up)/.test(s)) return "rappel";
  if (/(pas[\s_-]*intéress|pas[\s_-]*interess|not[\s_-]*interest|declin|refus)/.test(s)) return "pas_interesse";
  if (/(répondeur|repondeur|voicemail|machine|amd_machine)/.test(s)) return "repondeur";
  if (/(pas[\s_-]*de[\s_-]*r[ée]ponse|no[\s_-]*answer|no[\s_-]*response|noanswer|no_answer)/.test(s)) {
    return "pas_de_reponse";
  }
  // Soft positives written by Charlotte's prompt — "interested" means the
  // patient said yes to exploring but didn't make it to consultation_booked.
  // Bucket as RAPPEL so the operator follows up tomorrow on /desk.
  if (/(interested|interess|hot[\s_-]*lead|nouveau[\s_-]*dossier|new[\s_-]*case)/.test(s)) return "rappel";
  return "autre";
}

// Derive the bucket from a calls row, looking at both metadata.qualification
// (set explicitly by AI agent or human via /api/desk/disposition) and the
// raw disposition column (set by Twilio AMD / call termination).
export function bucketForCall(call: {
  disposition?: string | null;
  metadata?: { qualification?: string | null } | null;
  answered_at?: string | null;
}): QualBucket {
  const explicit = call.metadata?.qualification;
  if (explicit) {
    const b = normalizeQualification(explicit);
    if (b !== "autre") return b;
  }
  const disp = normalizeQualification(call.disposition ?? null);
  if (disp !== "autre") return disp;
  // Last-resort: if the call was never answered, it's "PAS DE REPONSE".
  if (!call.answered_at) return "pas_de_reponse";
  return "autre";
}
