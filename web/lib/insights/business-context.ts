// Édite cette constante pour donner du contexte métier à l'IA d'insights.
//
// Ce contenu est injecté dans le system prompt de Claude/DeepSeek avant chaque
// génération. Il aide le modèle à :
//   - proposer des counter-arguments ancrés dans votre réalité (procédures,
//     tarifs, parcours patient) au lieu de suggestions génériques
//   - reconnaître les "winning patterns" qui matchent vos vraies étapes
//   - éviter de promettre quelque chose que vous n'offrez pas
//
// Si la chaîne reste vide, le modèle fonctionne en mode générique.
// Tu peux remplir au fur et à mesure — chaque commit GitHub met à jour
// les insights au prochain run.

export const BUSINESS_CONTEXT = `
# Contexte métier — Clinique chirurgie de l'obésité au Royaume-Uni

## Parcours patient
- NHS WMP S2 (Specialist Weight Management Service Tier 3/4)
- Critères d'éligibilité : BMI ≥ 40, OU BMI ≥ 35 + comorbidité (diabète T2,
  hypertension, apnée du sommeil, NAFLD, OA, PCOS, GERD, dépression liée
  à l'obésité, dyslipidémie, CVD).

## Procédures proposées
<!-- À remplir : sleeve, bypass, mini-bypass, ballon, etc. -->

## Tarifs / financement
<!-- À remplir : tarifs privés, plans de paiement, prise en charge NHS partielle, etc. -->

## Étapes typiques d'un bon appel
<!-- À remplir : accueil, qualification BMI + santé, écoute des freins, présentation parcours, proposition de consultation médecin gratuite -->

## Objections fréquentes et réponses validées
<!-- À remplir : ex. "C'est trop cher" → réponse type validée par le directeur -->

## Ce que les agents NE doivent JAMAIS dire
<!-- À remplir : promesses médicales spécifiques, jugements de poids, comparaisons avec d'autres patients, etc. -->
`.trim()

export function hasBusinessContext(): boolean {
  // We consider the context "filled" once any non-template line is present.
  // The template lines all contain HTML comments — a real entry won't.
  const lines = BUSINESS_CONTEXT.split('\n')
  return lines.some(
    (l) =>
      l.trim().length > 0 &&
      !l.trim().startsWith('#') &&
      !l.trim().startsWith('<!--') &&
      !l.trim().startsWith('-')
  )
}
