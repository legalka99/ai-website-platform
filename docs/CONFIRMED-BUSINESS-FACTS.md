# Confirmed Business Facts

The server owns factual authority. AI outputs cannot create or extend evidence.

Current Owner Launch: persisted Brief version → `confirmedFactsFromBrief` → Business/Content → Orchestrator/Developer/QA. Persistence independently rebuilds the same facts through the run's immutable `source_brief_version_id`, project and organization binding. No facts supplied in agent results are trusted. No DB migration is needed.

`ConfirmedBusinessFacts` is a bounded, possibly empty facts collection, not a mandatory Brief. Each fact has `category`, original `value`, `source` (`owner_brief`, `briefVersionId`, `field`), and `qualifiers` containing complete conditional/negative clauses. A source kind is an explicit allowlist; future sources require implementation of server authorization and persistence before acceptance. Values and conditions are never shortened into unconditional offers.

The current Brief fact adapter includes companyName, description, productsOrServices, targetAudience, geography and advantages. websiteGoals and desiredActions are still mapped into the workflow Business input as intent, but are not admitted into ConfirmedBusinessFacts. Goals and CTA labels cannot become commercial evidence. Notes, design preferences, model-generated industry and legacy `businessFacts` are not evidence. Existing `businessFacts` remains accepted as descriptive input for compatibility, without authority.

## Structured advantages and authority transition

New Owner Brief writes represent `advantages` as an ordered array of strict `{text}` items. The array contains 0–8 items; each item is limited to 300 characters and all item text together remains within the former 1500-character field bound. Empty items, duplicates after case-normalization, HTML/control text, credential-like values, unknown object properties and accessors are rejected. Order is preserved through UI, API, JSONB persistence, parsing, facts and deterministic block points.

Each structured entry produces one exact fact whose source adds `item:{index,count}`. The immutable Brief version ID, field, zero-based index and total count bind the complete ordered group. Validation rejects mixed item/legacy/fragment provenance, duplicates, missing entries, inconsistent counts and accessors. Conditions, negation, quantities and scope remain inside the exact item value; an item such as “Монтаж только при заказе от 100 000 ₽” cannot authorize “Выполняем монтаж”.

Historical Brief documents keep `advantages:string|null`. Reads accept this bounded legacy union. Safe closed-grammar atomization may still reconstruct known legacy fragments; a mixed or unknown list remains one complete legacy fact. Historical rows are never rewritten or reinterpreted as structured items. The UI displays an unsafe legacy string as one editable advantage. Only an owner review and save creates a new immutable version containing the structured array; that explicit save is the authority transition. Since `project_briefs.document` is JSONB and immutable versions already support both shapes, no SQL migration is required.

`contentGroundingFacts` builds ready-to-reuse clauses only from the confirmed collection. Risky public claims require a complete confirmed clause or a supported bounded semantic equivalent preserving subject, scope, polarity, quantities and conditions. Internal planning fields are not public claims and never provide evidence. Negations and conditions are retained, including “Консультация без предоплаты”. The service detector also covers Russian verb forms for installation, delivery, measurement, consultation, engineering and ongoing support. It is a bounded heuristic, not a complete semantic proof. Unknown paraphrases of risky facts may still fail; the closed equivalence grammar does not perform general entailment. Only closed independent lists in the two allowed Brief categories are atomized; all other comma constructions stay whole and conditions must not be separated from their subjects.

The model receives both provenance-bearing facts and `groundingFacts` as allowed factual clauses. All inputs remain untrusted data for prompt-injection purposes. BusinessProfile still describes the business for structure/design, but does not establish new authority. The Orchestrator snapshots the authoritative collection before any agent runs and gives detached copies to agents. Validation and persistence do not use agent-modified copies as authority.

## Creative and block workflows

Product intent: a user can request a block with minimal instructions or supply detailed specifications. Factual authority constrains business assertions only; it does not require a large Brief before proposing structure, visuals or neutral copy.

`ProjectKnowledge` contains project identity and confirmed facts independently of a Brief. `UserInstruction` (also named `CreativeInstruction`), `MarketInsight` and draft `AISuggestion` are separate from confirmed evidence. Market insights carry research-source references; suggestions carry AI provenance and optional originating insight IDs. A future block path can use `Block Request → Project Knowledge → Design → Content → Developer → QA`. These types do not implement a block editor, new endpoint or automatic suggestion approval.

A user-approved suggestion must become a separately persisted, authorized owner confirmation with provenance. An AI-written “confirmed” status is never sufficient. Use Brief facts first. When information is insufficient, future market research may inform proposals, not claims about the client. Offers such as “Монтаж за 1 день”, prices, guarantees and free measurement must remain proposal-only until explicit user confirmation of their exact conditions. Preserve research/AI lineage in addition to the future owner-confirmation record. No research connector or competitor browsing is implemented here. That source adapter and approval operation are future work; the current runtime only accepts the implemented Owner Brief source. Existing Owner Launch still uses its existing Brief form; this change does not implement the future minimal block-request UI.

## Correction and migrations

Whole-site Content correction is retained for isolated tests but disabled by default, including active Website Workflow Launch. Block Workflow enables one grounding-only correction using its separate JSON telemetry storage and unchanged four-request budget. A server-only `allowCorrection` option is not exposed in HTTP input. Do not enable it for persisted workflows before separately reviewing evidence quality and usage storage.

Migration 006 remains deferred and is explicitly excluded from the migration loader. Tests also run without it. Active stages retain at most two provider attempts; five workflow generations fit the existing ten-request limit including Router fallback. No retry, fallback or budget policy was loosened.

## Deferred design debt

Design and Content share `designTextViolation` despite different prose requirements. This task does not change Design regex or security detectors. Separating the policies and resolving typography false positives is a separate step.

## Remaining limits

No LLM grounding or unrestricted paraphrase approval, automatic extraction from notes, multi-version knowledge reconciliation, user confirmation flow, block editor, or production live evaluation is implemented. Confirmed text can still be ambiguous; only complete clauses, the closed equivalence grammar and bounded detectors are enforced. Fail closed when no evidence is supplied for a detected risky claim. Persisted legacy runs without a Brief have no commercial evidence; new high-risk output cannot borrow authority from BusinessProfile.

### Safe deterministic fact atomization

The saved Brief is still the authority. Facts are reconstructed dynamically; no new DB column or migration is required. Legacy facts without fragment metadata remain readable with their former whole-field semantics.

For `advantages` and `productsOrServices` only, `atomicBriefValues` recognizes a complete list of 2–8 distinct allowlisted entries separated by commas, semicolons or newlines. Every item must match its category's closed dictionary in full (case-insensitive). Original spelling is retained, with only surrounding whitespace removed. Advantages include own production, quality hardware/materials and transparent pricing; offerings include explicit installation objects and bounded product names. No LLM, token pooling, arbitrary substring matching or general sentence parser creates authority.

Any unknown item, condition, negation, numeric promise, extra scope, third-party subject, exception, empty or repeated item prevents splitting of the entire field. Other Brief categories are never atomized. Conditions/quantities are preserved as part of the original field, not extracted into broader facts. `factualClauses` remains unchanged. Bullet/numbered lists and arbitrary product/service lists remain conservative whole fields.

Legacy atomic sources add `fragment: {index, originalValue}` to the existing kind/briefVersionId/field. Structured advantage sources use the separate `item:{index,count}` form described above. The validator recomputes legacy atomization, verifies each exact value, requires complete ordered groups and rejects cross-form mixing, duplicate indices, partial groups, accessors and unknown keys. A syntactically valid source is not proof of ownership: only the server adapter may supply it, and persistence independently reconstructs facts from the bound Brief/project/organization. No HTTP/model input promotes facts.

Content grounding receives the validated atomic values plus the complete original clause for backward-compatible complete-copy grounding. The original is taken only from a validated complete fragment group; it does not authorize arbitrary substrings. The equivalence grammar and numeric/negation/scope checks are unchanged. Existing risk detectors remain bounded heuristics, not universal linguistic proof.

## Public copy and creative intent

See [Creative grounding](CREATIVE-GROUNDING.md) for the public/internal field boundary, conservative paraphrase grammar, non-authoritative market/competitor/SEO context, intent normalization and pure exact-edit preflight. The existing Block MVP can generate neutral cards with sparse facts. Persisted exact editing and owner confirmation of suggestions remain deferred.
