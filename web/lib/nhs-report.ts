// Source of truth: clinic manager's "Rapport de suivi — Dossiers NHS"
// (PDF dated 09 juin 2026). Counts and patient lists are entered here
// verbatim so the dashboard reflects the actual state of the 41 submitted
// dossiers until the data is back-filled into the Supabase nhs_dossiers
// table.
//
// Update flow: edit this file when a new report arrives. Each category
// list drives both the headline count and the per-card drill-down.

export type NhsReportPatient = {
  name: string;
  sent_to_nhs?: string; // DD/MM/YYYY when known
  situation: string;
  surgery_when?: string; // e.g. "Juillet 2026" for approved patients with a scheduled date
};

export type NhsReportCategory = {
  key: NhsReportKey;
  label_fr: string;
  hint_fr: string;
  patients: NhsReportPatient[];
};

export type NhsReportKey =
  | "approved"
  | "pending_nhs"
  | "missing_docs"
  | "rejected"
  | "dropped_out"
  | "to_submit";

export const NHS_REPORT_AS_OF = "2026-06-09";

export const NHS_REPORT: Record<NhsReportKey, NhsReportCategory> = {
  approved: {
    key: "approved",
    label_fr: "Approuvés",
    hint_fr: "dont 6 déjà opérés",
    patients: [
      { name: "Pamela Akhtar", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Kelly Parker", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Yatta Tucker", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Cheryl Marie Thomplinson", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Mark Griffith", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Angela West", situation: "Opéré — phases 1 et 2 terminées." },
      { name: "Nathan Lees", situation: "Opération (phase 2) prévue en juillet 2026.", surgery_when: "Juillet 2026" },
      { name: "Christina Mckie", situation: "Opération (phase 2) prévue en juillet 2026.", surgery_when: "Juillet 2026" },
      { name: "Helen Andrews", situation: "Opération (phase 2) prévue en juillet 2026.", surgery_when: "Juillet 2026" },
      { name: "Sandra Ani Chukwueke", situation: "Opération (phase 2) prévue en août 2026.", surgery_when: "Août 2026" },
      { name: "Rebecca McIntyre", situation: "Opération (phase 2) prévue en août 2026.", surgery_when: "Août 2026" },
      { name: "Deborah Ginette Smith", situation: "Opération prévue en septembre 2026.", surgery_when: "Septembre 2026" },
      { name: "Jaime Pulford", situation: "Chirurgie du cou préalable — opération prévue en septembre 2026.", surgery_when: "Septembre 2026" },
      { name: "Milena Sienkiewicz-Dyminski", situation: "Sorti du parcours — ne souhaite pas continuer." },
      { name: "Mitchell Reece Robinson", situation: "Sorti du parcours — approuvé NHS mais ne peut pas régler les honoraires." },
      { name: "Shona Thompson", situation: "Sorti du parcours — approuvée le 23/04/2026, n'a pas souhaité continuer." },
    ],
  },
  pending_nhs: {
    key: "pending_nhs",
    label_fr: "En attente NHS",
    hint_fr: "réponse / appel en cours",
    patients: [
      { name: "Camila Rossi", sent_to_nhs: "09/04/2026", situation: "Réévaluation par le service bariatrique local requise avant financement S2." },
      { name: "Kyle Bishop", sent_to_nhs: "09/04/2026", situation: "Appel déposé le 22/05/2026 — accusé de réception NHS le 28/05/2026, réponse à venir." },
      { name: "Liesl Quinnell", sent_to_nhs: "28/05/2026", situation: "Éléments envoyés au NHS — réponse attendue." },
    ],
  },
  missing_docs: {
    key: "missing_docs",
    label_fr: "Éléments requis",
    hint_fr: "documents à fournir",
    patients: [
      { name: "Amy Marsden", sent_to_nhs: "04/06/2026", situation: "Preuves NHS Tier 3 + 1 justificatif de résidence en Angleterre." },
      { name: "Carly Marie", sent_to_nhs: "14/05/2026", situation: "Lettre du GP (orientation Tier 3 → Tier 4) + 2 justificatifs de résidence + relevés bancaires depuis oct. 2025." },
      { name: "Constanta Chirazic Lupu", sent_to_nhs: "28/05/2026", situation: "Consultation GP + preuves Tier 3 + 1 justificatif de résidence + relevés bancaires." },
      { name: "Kerrian Adair", sent_to_nhs: "28/05/2026", situation: "Preuves Tier 3 + justificatifs de résidence + relevés bancaires." },
      { name: "Lucy Oliver", sent_to_nhs: "28/05/2026", situation: "Participation Tier 3 + documentation d'achèvement + assiduité / suivi clinique." },
      { name: "Sunay Raimov", sent_to_nhs: "28/05/2026", situation: "Lettre de sortie Tier 3 + preuves complémentaires + 2 justificatifs de résidence + relevés bancaires." },
      { name: "Tammy Archer", sent_to_nhs: "28/05/2026", situation: "Engagement Tier 3/4 + 2 justificatifs de résidence + relevés bancaires + Council Tax." },
      { name: "Vicky Anne Hodges", sent_to_nhs: "09/04/2026", situation: "Engagement Tier 3 depuis mai 2025 + 2 justificatifs de résidence récents + relevés bancaires depuis oct. 2025 + Council Tax récent." },
      { name: "Ali Albhurgol", sent_to_nhs: "17/01/2026", situation: "En attente du statut de visa du patient." },
      { name: "Ginette Malonda", sent_to_nhs: "15/05/2026", situation: "Éligible S2, demande suspendue : renouvellement du titre de séjour et preuves médicales NHS attendus." },
      { name: "Elizabeth Smith", sent_to_nhs: "10/03/2026", situation: "Mise à jour niveau 3 demandée — RDV médecin traitant le 24/06/2026." },
      { name: "Jane Nassiwa", sent_to_nhs: "09/04/2026", situation: "Mise à jour niveau 3 — documentation du médecin traitant attendue." },
      { name: "Tanya Wilton", sent_to_nhs: "15/05/2026", situation: "Documentation du médecin traitant attendue." },
    ],
  },
  rejected: {
    key: "rejected",
    label_fr: "Rejetés",
    hint_fr: "critères ICB non remplis",
    patients: [
      { name: "Krystal Kemp", sent_to_nhs: "17/01/2026", situation: "Critères ICB non remplis — niveau 3 non complété, approbation refusée." },
      { name: "Carole Charman", sent_to_nhs: "22/01/2026", situation: "Aucun document justificatif fourni." },
      { name: "Luriann Alexander Braveboy", sent_to_nhs: "10/03/2026", situation: "Chirurgie privée antérieure — disqualifiée pour la voie S2." },
      { name: "Sian Jones", sent_to_nhs: "09/04/2026", situation: "En attente du document patient avant envoi en révision." },
      { name: "Linda Long", sent_to_nhs: "15/05/2026", situation: "Critères ICB non remplis — niveau 2 refusé en 2025. Envisage la Turquie en privé." },
    ],
  },
  dropped_out: {
    key: "dropped_out",
    label_fr: "Abandons",
    hint_fr: "ne souhaitent pas continuer",
    patients: [
      { name: "Bradley Liam Mitchell", sent_to_nhs: "17/01/2026", situation: "Ne souhaite pas continuer." },
      { name: "Oscar Gomez", sent_to_nhs: "28/01/2026", situation: "Documents non fournis — ne souhaite pas continuer." },
      { name: "Jasmin McFarlin", sent_to_nhs: "10/03/2026", situation: "Pas de justificatif niveau 3 — ne souhaite pas continuer." },
      { name: "Amira Mohamoud Mohamed", sent_to_nhs: "09/04/2026", situation: "A obtenu une date d'opération au Royaume-Uni (sous 6 mois)." },
    ],
  },
  to_submit: {
    key: "to_submit",
    label_fr: "À soumettre",
    hint_fr: "transmis au NHS en fin de semaine",
    patients: [
      { name: "Josephine Mark", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Valerie Wilcox", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Salma Ahmad", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Georgeta Roxana Iordache", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Karen Griffin", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Nathalie Maitre", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
      { name: "Ronel Greyling", situation: "Voie S2 — dossier prêt, transmission au NHS prévue en fin de semaine." },
    ],
  },
};

// Total submitted = approved + pending NHS + missing docs + rejected + dropped out.
// "À soumettre" is the upcoming batch, not yet sent — kept separate from the
// "TOTAL DOSSIERS" headline so the figure matches the manager's report (41).
export const NHS_REPORT_TOTAL_SUBMITTED =
  NHS_REPORT.approved.patients.length +
  NHS_REPORT.pending_nhs.patients.length +
  NHS_REPORT.missing_docs.patients.length +
  NHS_REPORT.rejected.patients.length +
  NHS_REPORT.dropped_out.patients.length;

// Sub-breakdown of the 16 approved patients (shown inline under the card).
export const NHS_REPORT_APPROVED_BREAKDOWN = {
  operated: NHS_REPORT.approved.patients.filter((p) => p.situation.startsWith("Opéré")).length,
  scheduled: NHS_REPORT.approved.patients.filter((p) => p.surgery_when).length,
  left_pathway: NHS_REPORT.approved.patients.filter((p) => p.situation.startsWith("Sorti")).length,
};
