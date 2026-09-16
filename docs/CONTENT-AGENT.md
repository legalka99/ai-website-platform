# Real Content Agent

**IMPLEMENTED:** existing Content contract, strict schema/runtime validation, DefaultContentAgent, routed service, WebsiteWorkflow integration, manual smoke infrastructure. Business and Design real OpenAI/Yandex smokes and commit 776fd1d are confirmed by the owner. Content has been tested offline only; its real smoke remains a manual next step.

## Exact contracts

The TypeScript fields of ContentAgentInput and ContentPlan are unchanged. There is no new page-planning system or Website Model redesign.

```ts
interface ContentAgentInput {
  business: BusinessProfile;
  design: DesignDirection;
}
interface ContentSection {
  type: string;
  purpose: string;
  heading?: string;
  text?: string;
  points?: string[];
  callToAction?: string;
}
interface ContentPlan {
  pageTitle: string;
  pageGoal: string;
  sections: ContentSection[];
  toneOfVoice: string;
  keyMessages: string[];
  notes?: string;
}
```

DefaultContentAgent.run accepts AgentContext<ContentAgentInput> with optional signal and returns Promise<AgentResult<ContentPlan>>. projectId/goal are context, not output properties. Goal supplies the current page intent. Metadata is not sent. pageType/slug/pageContext/existingContent/contentPreferences do not currently exist in this input and unknown fields are rejected. Future tone/length/keywords/forbidden-claims/required-sections/existing-copy preferences are PLANNED, not silently accepted now.

TypeScript retains type:string for compatibility. Runtime limits section types to hero, services, advantages, process, gallery, faq, testimonials, cta, contacts, text, custom. Array position is order: no IDs, duplicate IDs or explicit order fields exist. Content types are content direction, not WebsiteBlockType values; Developer must later map them to Website Model.

## Validation and limits

| Field | Runtime limit |
|---|---|
| pageTitle | Nonempty, 200 characters |
| pageGoal | Nonempty, 400 characters |
| toneOfVoice | Nonempty, 300 characters |
| keyMessages | 1–8 nonempty strings, 400 characters each |
| sections | 1–10 objects; prompt prefers 3–6 concise sections |
| section.purpose | Required, nonempty, 400 characters |
| section.heading | Optional, nonempty, 200 characters |
| section.text | Optional, nonempty, 2000 characters; plain paragraph newlines allowed |
| section.points | Optional, 1–8 nonempty strings, 400 characters each |
| section.callToAction | Optional, nonempty, 160 characters; at most four CTA-bearing sections |
| notes | Optional, nonempty, 1000 characters |

Every section needs at least one of heading, text or points. A cta section requires callToAction. At most one faq section with up to six question/answer directions in points; there is no separate FAQ item contract. Testimonials without supplied reviews are directions to obtain real reviews, never invented quotes. No SEO fields, contact URLs or email fields were added.

Root and nested unknown properties are rejected. Output resource limits: 32000 UTF-8 bytes, maximum string 2000, array 10, depth 5, nodes 300. Accessors, cycles, repeated references, prototypes, symbols and hidden properties are rejected before reading values. Errors contain fixed messages and schema paths, never unsafe field values or unknown property names.

Plain-text safety reuses Design's conservative prose policy, permitting paragraph newlines for content. It rejects code/HTML/script/markup, URLs/domains/email, credential-looking strings and control/encoding constructs. False positives are possible; this is not proof that arbitrary prose cannot contain an undisclosed secret. Accepted copy must later be rendered as text, never executed or inserted as HTML.

Input has exactly business/design, with resource limits 20000 bytes, string 8000, array 50, depth 5, nodes 600. Business reuses the existing bounded validation and required BusinessProfile checks; only BusinessProfile fields are accepted. Design passes its existing strict validator. Combined serialized user DATA is additionally limited to 18000 characters; goal to 2000 and projectId to 200. A validated snapshot prevents input mutation while awaiting the response.

Provider wire schema requires all properties, using nullable values for optional section fields and notes. Normalization removes only those known nulls, then validates the domain output. Unknown fields, empty strings and malformed JSON are never repaired into success. No markdown regex parser. The schema is a detached JSON snapshot to satisfy real adapter resource checks.

## Grounding and responsibility

The system prompt identifies all business/design/goal text as untrusted DATA and rejects instructions to change roles, reveal prompts/secrets, run commands or access external services. Business facts are the only basis for claims. It forbids inventing tenure, customer counts, warranties, prices, discounts, certificates, manufacturing/factory, geography, leadership, premium positioning, environmental claims, deadlines, legal facts and specifications. Missing data leads to neutral copy or explicit notes about needed information.

Design controls tone/density/layout only, never business facts: luxury styling does not imply a luxury company. These grounding instructions are tested on controlled fake responses; there is no NLP fact-checker or guarantee of live factual accuracy. Human review remains necessary, especially for claims, FAQ and testimonials.

For deterministic CTA grounding the current agent requires each callToAction to exactly equal one business.desiredActions string. This deliberately stricter first version rejects even paraphrases; semantic paraphrase matching is not implemented. It prevents silently changing “request a quote” to “buy now”. The context-free workflow validator checks CTA structure; the real agent checks CTA against business input.

Content generates a section plan and copy basis, not HTML/CSS/React, Website/WebsitePage blocks, publication or external SEO research.

## Runtime path and workflow

BusinessProfile + DesignDirection → ContentAgentInput → DefaultContentAgent created by createRoutedContentService → existing AIRouter (taskType content) → GuardedAIProvider → OpenAI/Yandex → normalized/validated ContentPlan → WebsiteWorkflow → Developer.

createRoutedContentService reuses createGuardedRouter. No new routing/cost-control implementation. The agent receives only AIRouter, no keys, SecretProvider, env, fs, network, shell or tools. Existing authorization and scoped credentials enforce actor/project/org boundaries; server configuration must come from a trusted caller.

createWebsiteWorkflowService now defaults to the routed Content Agent when no Content implementation is supplied. Existing explicitly injected Content remains supported for trusted callers/tests. Business/Design and the orchestrator stage order were not rewritten. A common server context and AICostGuard must be shared for Business, Design and Content; workflow telemetry records that Content is the third request in the full path.

Business failure/exception prevents downstream calls; Design failure stops Content; Content failure/exception/malformed stops Developer and preserves business/design state. Later Developer failure preserves content. Runtime validation remains mandatory before every stage. State and executions are per run. Developer/QA implementations were not changed or implemented.

## Fallback, cost and telemetry

Existing AIRouter permits configured fallback only after TIMEOUT, NETWORK, RATE_LIMIT or API_ERROR with transient 5xx permission. Auth/credentials, invalid input/output, validation, cancellation, budget, tenant/project/security denial never trigger another provider request. No separate retry loop.

Every attempt uses the shared cost guard: max output tokens, request count, concurrency, workflow reservations and bounded attempts. Fallback is a separate potentially charged request. Budget is reservation data, not actual cost.

Existing usage is preserved: actorId, organizationId, projectId, workflowId, agentType=content, provider/model, input/output/total/cachedInput tokens when available, durationMs, timestamp and requestId; routing holds each attempt/fallback. Server scope overrides provider-supplied identity. WebsiteWorkflowResult.executions.content retains metadata even when later stages fail. Do not double-count top-level usage and its matching attempt; cached tokens are included in input. Unknown values remain unknown. There is no price conversion or money calculation.

## Manual smoke

```sh
npm run smoke:content -- --provider=yandex --confirm-paid-request
npm run smoke:content -- --provider=openai --confirm-paid-request
```

Each command is one potentially paid request through the real Content service/router/guard/adapter. Arguments and explicit confirmation are checked before reading configuration. Unknown providers/flags are rejected locally. Without confirmation there is no provider call. Imports do not auto-run the script.

Input: educational glass-company BusinessProfile and compact neutral DesignDirection, no real client data. No extra Business or Design generation is performed by Content smoke. Existing .env is used only on explicit manual execution; it is not modified. Smoke ceiling: one attempt, one concurrent request, up to 2000 output tokens, retaining smaller configured limits. No fallback option in smoke; normal service fallback remains available by policy. These are technical limits, not client quotas.

Output includes ContentPlan under content, provider/model, project/workflow, available requestId/usage/routing/budget. It uses validated content, field allowlists, independent snapshots and existing redaction. No prompts, keys, Authorization, env contents, raw provider responses, SecretProvider values or stack traces. Snapshots prevent [CIRCULAR].

Offline smoke tests inject transport into real adapters and block default fetch. Tests never opt into real network calls or load the user's .env for Content smoke.

## Verification and next stage

442 tests pass, including the prior 351. Contract/security, routed parity, transient/no-fallback paths, cancellation, budgets/concurrency, scope, workflow and smoke tests are offline. No dependencies added. Required security/typecheck/test/diff checks are run before delivery. Live Content quality is not proven by fake responses.

PLANNED: Real Developer Agent, QA Agent, SEO/GEO, persistence, Client Token Quotas, Cost Accounting, Admin Console and Margin Analytics. Existing telemetry readiness remains; no billing/quota/pricing/UI engine was built. See USAGE-COST-ADMIN-PLAN.md. Code is ready for review and manual Content smoke; live validation should precede claiming that Content works with the selected real models.

## Диагностика INVALID_RESPONSE после успешной provider attempt

`outcome=success` означает, что адаптер принял structured JSON и его wire schema. Это не означает успешной проверки Content Agent. Последующий отказ normalization/resource/domain/semantic/CTA раньше терял причину и возвращал только INVALID_RESPONSE. Без отклонённого ответа или новой безопасной диагностики нельзя определить точное правило именно прошлого live-запуска.

Offline подтверждены расхождения прежней wire schema: произвольный CTA вместо exact desiredActions; все copy-поля null; секция cta без действия; FAQ с семью пунктами. Агент теперь строит request-specific wire schema: CTA — enum безопасных допустимых desiredActions (без изменения exact-match); каждая секция содержит copy; cta требует действие; FAQ ограничен шестью points. Nullable optional поля по-прежнему нормализуются только из null в отсутствие. Пустые строки/массивы и additionalProperties не разрешены. Domain validation не ослаблялась.

Общие лимиты количества CTA/FAQ, resource limits и security heuristics остаются обязательной локальной границей. Они не считаются гарантированными одним structured-output API: провайдер может вернуть wire-valid текст, который не проходит политику безопасности. Такой текст по-прежнему отвергается; маскировать отказ успешным результатом нельзя.

На failure smoke выводит безопасный объект validationError: stage, path, rule. Стадии: content-json, content-resource, content-schema, content-semantic, provider-output. Примеры правил: CTA_NOT_ALLOWED, SECTION_COPY_REQUIRED, CTA_REQUIRED, FAQ_POINTS_LIMIT, CTA_LIMIT, FAQ_LIMIT, UNSAFE_TEXT, SCHEMA_ADDITIONAL_PROPERTIES. UNSAFE_TEXT объединяет прежние URL/code/credential heuristics; отклонённый текст не выводится. provider-output означает отказ адаптера, без заявления о неизвестной внутренней причине. Пути и правила проходят отдельный allowlist, дополнительные поля и getters исключаются.

Regression checks воспроизводят старую рассинхронизацию, nullable/empty/extra/type cases, безопасные diagnostics, сохранение usage/routing и настоящий OpenAI adapter с offline transport. Реального API-вызова не было. Для следующего ручного запроса достаточно прежней команды smoke:content с --provider=openai --confirm-paid-request; она по-прежнему ограничена одной попыткой.


## Аудит toneOfVoice и безопасные subrules

Точное rejected value live-запуска не сохранено: его причина неизвестна. Оба русских примера из задачи уже проходили validator. Воспроизводимый отдельный false positive: безопасный тон с точкой с запятой отвергался из-за prose allowlist. Только для toneOfVoice эта пунктуация проверяется как запятая, без изменения возвращаемого текста. Остальные поля и допустимость Design текста не расширены; URL/HTML/code/credentials запрещены. Content instruction/shell detectors проверяются до нормализации и применяются также к допустимым CTA в wire schema.

Статический аудит: английские keyword regex используют ASCII word boundaries, поэтому Classical/Importantly проходят, но First-class, window и другие омонимы консервативно отвергаются. Русская credential эвристика использует substring matching (например, секрет): безопасные фразы тоже могут быть отклонены. Domain-like точки могут распознаваться как адрес. Markdown emphasis/backticks, slash, control/zero-width символы и часть Unicode punctuation запрещены prose allowlist. Эти широкие правила не ослаблены без отдельного решения о политике. Буквы Unicode, обычные тире, кавычки и скобки поддерживаются. Heuristics не доказывают отсутствие всех jailbreak или неизвестных secrets; принятый текст нельзя исполнять.

Value-free rule уточняет первый детектор: UNSAFE_URL, UNSAFE_HTML, UNSAFE_CREDENTIAL, UNSAFE_PROMPT_INJECTION, UNSAFE_CODE, UNSAFE_SHELL, UNSAFE_CHARACTERS, UNSAFE_EMPTY_TEXT. При нескольких совпадениях возвращается один код; он не доказывает злонамеренность. Старый UNSAFE_TEXT остаётся в allowlist для совместимости. Matches/значения/динамические имена не передаются наружу. Общая Design boolean policy сохранена при извлечении диагностической функции.

503 offline теста проходят. Regression проверяет также OpenAI adapter → guard → Router → Content Agent → smoke через fake transport: безопасный tone сохраняется, опасный отклоняется с фиксированным кодом, usage/routing сохраняются. Следующий контролируемый ручной smoke может уточнить live-причину; успех не гарантирован. Реальных API-вызовов, изменений .env и commit не было.
