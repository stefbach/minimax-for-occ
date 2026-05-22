# Axon — Persona Library

Bibliothèque de personas IA prêts à cloner dans n'importe quelle organisation Axon. Inspiré du repo `agency-agents` (144 personas devs), adapté ici aux **agents vocaux**.

Chaque persona est un fichier Markdown avec un **YAML frontmatter** structuré + un **corps Markdown** qui sert directement de `system_prompt` à l'agent vocal.

## Format d'un persona

```markdown
---
slug: hotel-concierge-fr
title: Conciergerie hôtelière (FR)
industry: hospitality
language: fr
voice_suggestion: female_warm_30s
llm_model: gpt-4o-mini
max_call_duration_secs: 600
tags: [hospitality, inbound, concierge]
n8n_bindings_suggested:
  - book_room
  - check_availability
  - transfer_to_reception
handoff_team_suggested: hotel-team
---

## Identity
Tu es Sophie, conciergerie de l'Hôtel des Pins...

## Mission
...

## Rules
- TOUJOURS te présenter...

## Workflow
1. Greeting personnalisé...

## Success Metrics
- Taux de résolution sans transfer > 60%
```

### Champs YAML attendus

| Champ                       | Type            | Obligatoire | Notes                                              |
|----------------------------|-----------------|-------------|----------------------------------------------------|
| `slug`                     | string          | oui         | Identifiant kebab-case unique                      |
| `title`                    | string          | oui         | Titre lisible affiché dans la marketplace          |
| `industry`                 | string          | oui         | Sous-dossier de classement                         |
| `language`                 | string          | oui         | `fr`, `en`, `es`, `de`, `it`, `multi`              |
| `voice_suggestion`         | string          | non         | Hint pour le choix de voix (gender_style_age)      |
| `llm_model`                | string          | non         | Recommandation modèle LLM                          |
| `max_call_duration_secs`   | number          | non         | Durée max recommandée (sécurité coût/UX)           |
| `tags`                     | array string    | non         | Filtres marketplace                                |
| `n8n_bindings_suggested`   | array string    | non         | Workflows n8n à brancher                           |
| `handoff_team_suggested`   | string          | non         | Team handoff (swarm) à associer                    |

### Sections Markdown attendues (libres mais conventionnelles)

- **Identity** — qui est l'agent, son ton de voix
- **Mission** — objectif business clair
- **Rules** — règles strictes (do / don't)
- **Workflow** — déroulé conversationnel étape par étape
- **Success Metrics** — comment mesurer la performance
- **Tournures à privilégier** — phrases types (optionnel)
- **Pièges à éviter** — anti-patterns (optionnel)

## Industries disponibles

| Dossier         | Description                                        |
|-----------------|----------------------------------------------------|
| `hospitality/`  | Hôtels, restaurants, spas                          |
| `sales/`        | Prospection, qualification, prise de rdv, renouvellement |
| `support/`      | Support N1, routage, facturation, e-commerce       |
| `medical/`      | Cabinets, cliniques, pharmacies, suivi de soins    |
| `legal/`        | Intake cabinet d'avocats, qualification dossier    |
| `realestate/`   | Qualification acquéreur, planification visites     |
| `survey/`       | NPS, études de marché                              |
| `collections/`  | Recouvrement amiable et ferme                      |
| `recruitment/`  | Screening candidats, planification entretiens      |

## Comment cloner un persona dans son org

Trois moyens :

1. **UI** — page `/agents/library` → bouton "Cloner dans mon org"
2. **API** — `POST /api/personas/{slug}/clone` avec body `{ name?, voice_id?, llm_model? }`
3. **CLI / curl** — depuis un script de seed

Le clone crée un nouvel agent IA dans la table `agents` avec :
- `system_prompt` = corps Markdown du persona
- `name` = `title` du frontmatter (ou `name` du body request)
- `language` = `language` du frontmatter
- `llm_model` = `llm_model` du frontmatter (override possible)
- `metadata.persona_source = slug` (traçabilité)

## Contribuer un nouveau persona

1. Choisir l'industrie (créer un sous-dossier si besoin)
2. Créer un fichier `mon-persona.md` avec frontmatter complet
3. Slug = nom du fichier sans `.md`
4. Tester le clone en local (`/agents/library` → "Cloner")
5. Tester l'agent : appel test + 3 scénarios (cas heureux, edge case, hors-périmètre)
6. PR avec captures d'écran d'un appel test

## Bonnes pratiques de rédaction

- **Tutoiement** dans le prompt (l'IA répond mieux à "Tu es..." qu'à "Vous êtes...")
- **Règles** courtes et explicites, jamais ambigües
- **Toujours** une règle "ne JAMAIS faire X" pour les cas dangereux (médical, juridique, financier)
- Le **workflow** doit être numéroté pour que le LLM le suive
- Inclure des **tournures à privilégier** : 80% de la qualité vocale = bonnes formules
- Le prompt complet doit tenir en **80-150 lignes** : assez détaillé pour cadrer, assez court pour rester en contexte

## Fichiers existants

Voir `personas/<industrie>/*.md`. 25 personas livrés en Phase 12.
