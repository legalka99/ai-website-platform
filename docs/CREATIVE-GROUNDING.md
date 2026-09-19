# Creative generation and factual authority

Current implementation separates public Content copy from internal planning. It uses existing guarded Router calls, security validation, immutable ConfirmedBusinessFacts and downstream revalidation. No migration or new dependency is required.

## Validation boundaries

- **Hard factual guard:** pageTitle, section heading/text/points. Detected risky claims require one complete confirmed clause or a supported full-clause semantic equivalent. CTA retains exact desiredActions authority. No market context, BusinessProfile, instruction or internal field provides evidence.
- **Creative zone:** neutral structure, headlines, visitor considerations and draft copy can be generated without a detailed Brief. Advantages retain 3–8 points, preferably 3–6 independently readable cards.
- **Internal planning:** pageGoal, toneOfVoice, keyMessages, notes and section purpose do not fail factual grounding merely for discussing commercial topics. Schema, size limits, script/URL/credential/prompt-injection checks remain mandatory. These fields are not copied into canonical Website content. Developer reuse validation accepts only explicit public fields.
- **Soft evaluation:** existing AI QA assesses public content quality, business/design alignment, SEO and UX. It cannot authorize an unsupported claim or override the deterministic guard. No new judge call, repair loop or budget exception is introduced.

`content-publication.ts` owns public section projection. The same grounding validator is used by Content, block/whole-site workflows and downstream validation. Both safe block diagnostic events are retained; no raw model values are added to logging.

## Conservative paraphrase grammar

`claim-equivalence.ts` parses complete clauses into company subject, predicate, polarity, object scope, quantity and qualifier slots. Only explicit predicate aliases and a small object vocabulary are accepted. Examples: “Выполняем монтаж стеклянных перегородок” → “Устанавливаем стеклянные перегородки”; “Прозрачные цены” → “Прозрачное ценообразование”. Conditions and scope must remain identical. Named third-party subjects, absent qualifiers, changed numbers and cross-fact pooling cannot match. Exact fallback also checks numeric literals, including signs and decimal punctuation.

This is **not general natural-language entailment**. Unknown risky paraphrases remain rejected. Closed independent lists in advantages/productsOrServices now support deterministic atomization with verified fragment provenance (see CONFIRMED-BUSINESS-FACTS.md). Ambiguous lists and arbitrary semantic inference remain unsupported. Existing bounded RU/EN risk detectors are not an exhaustive guarantee against every possible unsupported assertion. LLM phrasing quality still needs controlled live evaluation; offline fixtures only verify the implemented boundaries.

## Context and operations

`CreativeContext` optionally carries bounded marketInsights, competitorInsights and seoContext. It is validated as plain, size-limited, safe data and sent to Content as untrusted strategy. It is never merged into ConfirmedBusinessFacts. No Research Agent, generated market dataset or HTTP research endpoint exists. Detailed research provenance/persistence remains future work; authoritative promotion still needs an implemented owner-confirmation path.

`GenerationOperation` reserves GENERATE, REWRITE, REPLACE_EXACT, EDIT, DELETE, ADD and MOVE. Block generation currently executes only GENERATE. A bounded typo map converts “сдеалй блок примущства” into a generation hint for advantages, preserving raw input as non-authoritative data. It is not general NLU. Explicit edit commands are refused by the generation path rather than sent for creative rewriting. ADD/MOVE/etc. are reserved types, not implemented persisted operations.

`replaceExactContent` is a pure preflight helper, **not a new API or persisted block editor**. A future authenticated adapter must resolve ownership and authoritative project knowledge server-side. The helper checks project/page/block target and expected old text, changes only that field, preserves replacement bytes and validates the resulting plan. It does not correct replacement typos, invoke AI, alter siblings or bypass grounding. Invalid/unsupported replacements fail without automatic rewriting.

## Open-source evaluation

Reviewed public sources on 2026-09-18; no package installed:

- [llm-contract](https://github.com/alivirgo/llm-contract), [package manifest](https://github.com/alivirgo/LLM-Contract/blob/main/package.json), [grounding assertions](https://github.com/alivirgo/LLM-Contract/blob/main/src/assertions/grounding.ts): the inspected 0.10.1 package is MIT, ESM/TypeScript, Node >=18.18, with optional schema peers and no mandatory runtime dependencies. Runtime compatibility is plausible. Its heuristic unsupported-claim check accepts absent context and checks extracted entities using substring presence. Fact preservation is not a scoped business entailment proof. The optional judge delegates to an LLM adapter and would require our guarded Router/budget integration; reports can contain raw output/evidence. Useful as a future evaluation harness, but does not replace provenance, authorization or the hard factual guard. No dependency added.
- [groundrails](https://github.com/stellarshenson/groundrails): Python grounding stack with lexical retrieval and optional semantic models/NLI. Relevant evidence/claim separation ideas, but a new Python/model runtime and calibrated thresholds would add substantial operational scope.
- [Guardrails AI](https://github.com/guardrails-ai/guardrails): useful validator/composition reference. A framework or reask mechanism does not itself provide project-specific factual authority; no new service/runtime is justified for this patch.

## Verification and next live evaluation

Offline tests cover public/internal separation, supported paraphrases, scope/condition/negation/quantity preservation, non-authoritative creative context, sparse facts, typo intent, literal edits, unchanged CTA/security and both workflow paths. Existing API/persistence suites retain isolation, diagnostics and transaction checks.

Next owner-controlled live test: generate one neutral advantages block from a short/typo request with sparse facts; then use separately confirmed scoped facts to assess paraphrasing. Inspect only safe diagnostics, output cards and normal usage telemetry. Do not infer live quality from fake-provider tests. Whole-site Content correction remains disabled by default; Block Content now permits one bounded grounding correction (see BLOCK-GENERATION.md); migration 006 remains deferred; migration 007 is unchanged.

## Files changed for this task

Existing uncommitted Block MVP files remain in place. This task modifies/adds:

- `packages/core/src/generation-intent.ts` — operation, intent, creative context and exact replacement types.
- `packages/ai/src/contracts/content-publication.ts`, `content-agent-input.ts`, `content-plan-schema.ts` — publication boundary, context input and field descriptions.
- `packages/ai/src/validation/claim-equivalence.ts`, `content-grounding-validator.ts`, `developer-output-validator.ts` — conservative equivalence, public-only factual guard and explicit public copy reuse.
- `packages/ai/src/agents/content-schema.ts`, `default-content-agent.ts`, `default-qa-agent.ts` — context validation and public/internal/creative guidance.
- `packages/ai/src/services/generation-intent.ts`, `exact-content-replacement.ts`, `developer-website-builder.ts`, `block-workflow.ts` — normalization, literal edit preflight, public projection and block context integration.
- `packages/ai/src/orchestrator/website-workflow-types.ts`, `website-workflow-orchestrator.ts` — optional creative context passed to Content only.
- `tests/creative-grounding.test.mjs` — new regression coverage; `tests/confirmed-business-facts.test.mjs`, `content-grounding.test.mjs`, `routed-content.test.mjs`, `content-advantages-guidance.test.mjs` — align old assertions with the explicit public/internal boundary, retaining public claim failure cases.
- `README.md`, `docs/KLEO-SPEC.md`, `docs/CONFIRMED-BUSINESS-FACTS.md`, this document — current architecture and limitations.

Verification: typecheck PASS; ordinary offline suite 1220/1220; Auth/API 157/157; isolated PostgreSQL persistence 47/47 (1424 total). Security check and secret scan PASS, no findings. Diff check PASS. Tests use fake AI providers; live AI calls: none. Migration 006/007 edits: none. Commit: none. Working tree intentionally remains dirty with the prior Block MVP work plus this task.
