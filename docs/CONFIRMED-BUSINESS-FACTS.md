# Confirmed Business Facts

The server owns factual authority. AI outputs cannot create or extend evidence.

Current Owner Launch: persisted Brief version → `confirmedFactsFromBrief` → Business/Content → Orchestrator/Developer/QA. Persistence independently rebuilds the same facts through the run's immutable `source_brief_version_id`, project and organization binding. No facts supplied in agent results are trusted. No DB migration is needed.

`ConfirmedBusinessFacts` is a bounded, possibly empty facts collection, not a mandatory Brief. Each fact has `category`, original `value`, `source` (`owner_brief`, `briefVersionId`, `field`), and `qualifiers` containing complete conditional/negative clauses. A source kind is an explicit allowlist; future sources require implementation of server authorization and persistence before acceptance. Values and conditions are never shortened into unconditional offers.

The current Brief fact adapter includes companyName, description, productsOrServices, targetAudience, geography and advantages. websiteGoals and desiredActions are still mapped into the workflow Business input as intent, but are not admitted into ConfirmedBusinessFacts. Goals and CTA labels cannot become commercial evidence. Notes, design preferences, model-generated industry and legacy `businessFacts` are not evidence. Existing `businessFacts` remains accepted as descriptive input for compatibility, without authority.

`contentGroundingFacts` builds ready-to-reuse clauses only from the confirmed collection. Risky claims still require exact normalized complete-clause matching. Negations and conditions are retained, including “Консультация без предоплаты”. The service detector also covers Russian verb forms for installation, delivery, measurement, consultation, engineering and ongoing support. It is a bounded heuristic, not a complete semantic proof. Safe paraphrases of risky facts may still fail. Lists are not split on commas; conditions must not be separated from their subjects.

The model receives both provenance-bearing facts and `groundingFacts` as allowed factual clauses. All inputs remain untrusted data for prompt-injection purposes. BusinessProfile still describes the business for structure/design, but does not establish new authority. The Orchestrator snapshots the authoritative collection before any agent runs and gives detached copies to agents. Validation and persistence do not use agent-modified copies as authority.

## Creative and block workflows

Product intent: a user can request a block with minimal instructions or supply detailed specifications. Factual authority constrains business assertions only; it does not require a large Brief before proposing structure, visuals or neutral copy.

`ProjectKnowledge` contains project identity and confirmed facts independently of a Brief. `UserInstruction` (also named `CreativeInstruction`), `MarketInsight` and draft `AISuggestion` are separate from confirmed evidence. Market insights carry research-source references; suggestions carry AI provenance and optional originating insight IDs. A future block path can use `Block Request → Project Knowledge → Design → Content → Developer → QA`. These types do not implement a block editor, new endpoint or automatic suggestion approval.

A user-approved suggestion must become a separately persisted, authorized owner confirmation with provenance. An AI-written “confirmed” status is never sufficient. Use Brief facts first. When information is insufficient, future market research may inform proposals, not claims about the client. Offers such as “Монтаж за 1 день”, prices, guarantees and free measurement must remain proposal-only until explicit user confirmation of their exact conditions. Preserve research/AI lineage in addition to the future owner-confirmation record. No research connector or competitor browsing is implemented here. That source adapter and approval operation are future work; the current runtime only accepts the implemented Owner Brief source. Existing Owner Launch still uses its existing Brief form; this change does not implement the future minimal block-request UI.

## Correction and migrations

Content correction is retained for isolated tests but disabled by default, including active Workflow Launch. A server-only `allowCorrection` option is not exposed in HTTP input. Do not enable it for persisted workflows before separately reviewing evidence quality and usage storage.

Migration 006 remains deferred and is explicitly excluded from the migration loader. Tests also run without it. Active stages retain at most two provider attempts; five workflow generations fit the existing ten-request limit including Router fallback. No retry, fallback or budget policy was loosened.

## Deferred design debt

Design and Content share `designTextViolation` despite different prose requirements. This task does not change Design regex or security detectors. Separating the policies and resolving typography false positives is a separate step.

## Remaining limits

No semantic/LLM grounding, free paraphrase approval, automatic extraction from notes, multi-version knowledge reconciliation, user confirmation flow, block editor, or production live evaluation is implemented. Confirmed text can still be ambiguous; only exact clauses and bounded detectors are enforced. Fail closed when no evidence is supplied for a detected risky claim. Persisted legacy runs without a Brief have no commercial evidence; new high-risk output cannot borrow authority from BusinessProfile.
