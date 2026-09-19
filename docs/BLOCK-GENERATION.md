# Block Generation MVP

Реализован create одного draft-блока. Это отдельный управляемый синхронный API-запрос; фоновой очереди, автоматического resume и live AI проверки качества в этом этапе нет.

## Scope и workflow

`GenerationScope`: block (`pageId`, optional `blockId`), page (`pageId`), site. В block endpoint scope восстанавливает сервер по авторизованному project/page/run; клиент не передаёт organization, actor, budget или status. Site pipeline сохранён. Page — только контракт. Revise проверяет принадлежность block и пока отвечает UNAVAILABLE; нельзя молча создать новый блок вместо редактирования.

`Block Request → Project Knowledge → Design → Content → Developer → QA → Block Version`:

- Design детерминированно использует существующий DesignSystem. Дополнительный Design AI-вызов не нужен.
- Content использует существующие guarded Router/provider boundary, CONTENT_INSTRUCTIONS и строгую ContentPlan wire schema с ровно одной секцией. Тип из allowlist: hero, advantages, services, process, faq, cta, text; при явном выборе тип обязан совпасть. Свободная инструкция передаётся только как untrusted DATA. Соседний контекст ограничен типами последних трёх блоков; их тексты не копируются в AI-запрос.
- Developer повторно использует детерминированный канонический builder. AI не получает управление IDs или Website status. `process` представлен каноническим `text` с points: текущая Website Model не содержит отдельного process-renderer.
- QA использует существующий реальный QA Agent/Router и deterministic QA на изолированном представлении одной секции. Неизменяемые соседи не становятся предметом QA. При invalid output / QA rejection версия не создаётся.
- Persistence повторно проверяет Content/security/grounding, QA и точное соответствие блока серверной сборке и target IDs. Вставляет identity и immutable version атомарно. Не пишет в website_versions, страницы или соседние блоки.

Никакого HTML/CSS/JS, preview renderer или публикации. Style/layout возможности MVP ограничены каноническим builder и существующим дизайном; это не новый визуальный редактор.

## Project Knowledge

Полный Brief не обязателен. При запуске сервер связывает run с последней сохранённой immutable версией Brief, если она есть. Из этой конкретной версии строится ConfirmedBusinessFacts; ссылка `source_brief_id` сохраняется в run, доступном из версии блока. При финальном сохранении evidence загружается заново по той же привязке. Без Brief используются пустые facts и нейтральный CTA «Подробнее».

Синтетические BusinessProfile labels описывают задачу, не являются evidence. User instruction, BusinessProfile, desiredActions, дизайн и пожелания не подтверждают коммерческие факты. Унаследованные grounding validators остаются обязательными. Market Insights и AI Suggestions по прежней provenance-модели не повышаются до confirmed facts без подтверждения пользователя. Market research / confirmation UI здесь не реализуются.

## Persistence: migration 007

`007_block_generation.sql` добавляет:

- `block_pages`: immutable page/design baseline, project/org и optional source website_version;
- `block_runs`: исходную инструкцию, выбранный тип, server block ID, actor/request, source Brief, stage/status/deadline/safe error;
- `blocks`: identity и принадлежность странице;
- `block_versions`: immutable canonical block, version, run, QA, timestamp;
- `block_execution`: persisted stage statuses и существующую безопасную usage projection (provider/model/token counts/outcome/request ID);
- `block_audit`: immutable started/completed/failed events, через run связанные с actor/request/scope.

Composite FK не позволяют связать чужие project/org/page/block/Brief. Trigger запрещает менять run binding и terminal run, mutable grants ограничены status/telemetry. API DB role не может перезаписывать или удалять версии. Подготовка страниц и чтение админом аудируются без исходного текста в журнале.

Baseline страницы один раз импортируется из существующей Website Version либо создаётся пустая Главная. Последующие full-site версии автоматически не подменяют этот baseline. Будущий preview должен композиционно читать baseline + последние block_versions; блоки сейчас не выдаются за новую full-site Website Version. API blocks выдаёт сохранённые block versions; raw AI-response отсутствует. Телеметрия block хранится в block_execution, пока не объединена с общим Finance экраном.

Миграция 007 проверена только на изолированных тестовых PostgreSQL. Её применение к рабочей БД — отдельный операционный шаг. Migration 006 не изменяется и не применяется; отложенный stash не используется. После обновления рабочей схемы нужны актуальные api-grants. API этой версии предполагает наличие 007.

## API и доступ

Все пути относительно `/api/v1/admin/projects/:projectId`:

- POST `/block-pages`: idempotencyKey; инициализация baseline страниц.
- POST `/block-workflows`: pageId, instruction (1–2000 символов), optional blockType/blockId, idempotencyKey; возвращает runId после завершения синхронного выполнения (201) либо receipt существующего run (200).
- GET `/block-workflows`: доступность, страницы, последний сохранённый run.
- GET `/block-workflows/:runId`: scoped конкретный run.
- GET `/blocks`: сохранённые версии блоков проекта.
- GET `/blocks/:blockId/versions`: история конкретного блока.

Только активный platform_owner запускает/готовит страницы. platform_admin читает с аудитом. Tenant-пользователь не получает platform bypass. Существующие cookie session, CSRF, Origin/CORS, input schemas и rate limits сохранены.

Проект блокируется транзакционно при prepare; уникальный running block run и взаимная проверка full-site/block исключают параллельный запуск в одном проекте. Idempotency проверяет полный request payload; одинаковый ключ не выполняет AI повторно, несовпадающий payload — conflict. UI блокирует double click; сервер остаётся авторитетным.

## Бюджет и отказ

Server-owned BLOCK_LIMITS: максимум **4 provider attempts**, **2000 output tokens/request**, **8000 reserved output tokens/run**, **120 секунд**. Обычно два AI-запроса: Content и QA; максимум четыре с обычным Router fallback. Provider timeout ограничен 45 секундами. Shared block AICostGuard: concurrency 1 в процессе, 20 requests/min/project, provider retries 0. Correction отсутствует. Monetary cost не выдумывается.

Budget counters пока in-memory, как в existing guard; DB running lock и отсутствие automatic resume не позволяют превратить API restart в повтор этого же run. Распределённый глобальный budget/concurrency нескольких API-инстансов — отдельный будущий этап. Failed stage usage сохраняется безопасной projection, без prompt/response/secrets. Таймаут не сохраняет поздний результат. После crash может остаться running запись с истёкшим deadline: UI показывает прерванный процесс, новый запуск блокируется до операторской проверки; автоматического retry/resume/снятия lock нет.

## Console и границы MVP

В проекте раздел «Создание»: режим блока, страница, свободная инструкция, optional type, создание и сохранённый статус. Страница/сайт отключены с «Скоро». При пустом проекте доступна подготовка Главной без Brief. После refresh читается БД; ошибки отображаются безопасно. Существующий full-site launcher остаётся отдельным разделом.

Не реализованы: revise execution/UI, page generation, новый site generation UI, визуальный block editor/preview, Tilda/Beget/deploy, market research, production release. Обязательный security/pentest gate перед публичным запуском остаётся в силе.

## Проверки

Offline unit tests проверяют семь типов, scope, grounding, untrusted instructions, strict output/CTA, target-only QA, siblings, budget/cancellation/fallback. Auth/API suite с ограниченной ролью PostgreSQL проверяет сохранение, immutable версии, audit/usage, роли, foreign scopes, server IDs, idempotency/concurrency, source Brief, timeout/restart и full-site exclusion. Browser suite проверяет создание, disabled modes, double click, refresh, безопасные ошибки и роли. Все AI adapters в тестах — fake, live-вызовов нет.

## Bounded Content correction (current)

This supersedes the earlier no-correction statement. One new Content generation is permitted only after a safe content-grounding rejection. Schema/JSON/security/CTA/provider/timeout/cancellation failures do not trigger correction. The original DATA is reused with a shared allowlisted diagnostic projection and fixed correction instruction; rejected output is never replayed. Both results pass the same validators. A second grounding failure returns INVALID_RESPONSE. No third generation exists.

Normal success takes two requests (Content + QA), corrected success takes three without fallback. BLOCK_LIMITS remains four provider requests / 8000 reserved output tokens; Router fallback is unchanged and may exhaust the budget before correction or QA, producing controlled LIMIT_EXCEEDED. Each request uses the same AICostGuard with maxRetries=0. Before correction, onStage persists the first paid telemetry while Content remains active. Final telemetry concatenates routing attempts, including failures; usage refers to the latest response, while routing.attempts and the persisted usage array retain all costs without duplication. Existing JSON storage supports four Content attempts; no migration is needed. Safe Content/QA logging remains on final failure only. A crash during an external request can still leave that request cost unknown; no automatic resume was added.

Files changed for bounded correction: `packages/ai/src/agents/content-correction.ts` (new shared safe messages/gate), `packages/ai/src/agents/default-content-agent.ts`, `packages/ai/src/services/block-workflow.ts`; `tests/block-content-correction.test.mjs` (new), `tests/block-workflow.test.mjs`, `tests/content-advantages-guidance.test.mjs`, `tests/content-commercial-grounding.test.mjs`, `tests/creative-grounding.test.mjs`, `tests/auth/api.test.mjs`; `README.md`, `docs/KLEO-SPEC.md`, `docs/BLOCK-GENERATION.md`, `docs/CONFIRMED-BUSINESS-FACTS.md`, `docs/CREATIVE-GROUNDING.md`. Prior uncommitted work is preserved.

Bounded-correction verification: typecheck PASS; 1242 ordinary offline tests, 158 Auth/API tests and 47 persistence tests PASS (1447 total). API regression verifies first usage is persisted before the second generation, both usages survive completion, only grounded content is versioned and replay launches no new calls. Security/secret scan and diff check PASS. No live AI calls, migration changes or commit.


## Fact-aware correction and isolated QA scope

Correction still rebuilds the ContentPlan from the original DATA plus a safe diagnostic, without replaying rejected text. The prompt uses path/rule to focus on the risk category, reselects available confirmed atomic advantages, permits safe paraphrases and asks for one fact per card, preferably 3–6. Neutral fallback is per unsupported card, not the default for the entire block. Literal preservation of previous lines is not promised because those lines are intentionally absent. Original DATA already carries groundingFacts, provenance, requestedType and normalized intent; no additional untrusted authority or model output is supplied. Existing structural limits, all validators and the two-generation cap remain unchanged. This is guidance, not a deterministic guarantee of writing quality.

QA scope is an internal service/constructor choice: Block Workflow selects `block`; the default remains `website`. It is not an accepted HTTP/model/input field. Block mode requires one page carrier containing one target block, omits page SEO data from provider DATA, skips only the standalone deterministic page-title SEO finding and supplies a scoped provider schema without SEO_INVALID. All schema/security/grounding/reuse/CTA/design checks remain. Block instructions exclude page/site SEO concerns even under recommendations or alternative codes, while retaining block content quality, structure, UX and accessibility review. Whole-site instructions/schema/parser/SEO checks remain enabled.

An out-of-scope provider SEO_INVALID is rejected with the existing safe QA schema diagnostic, not silently deleted from a report or converted into PASS. Free-text scope violations under another allowed code cannot be universally identified deterministically; live semantic quality remains subject to evaluation. Public API, QAReport contract, database schema and logging projection are unchanged. No extra AI calls/retries.

Files changed for this refinement: packages/ai/src/agents/content-correction.ts, default-qa-agent.ts, qa-schema.ts; packages/ai/src/services/routed-qa-service.ts, block-workflow.ts; tests/block-content-correction.test.mjs, block-qa-scope.test.mjs, auth/api.test.mjs; README.md, docs/KLEO-SPEC.md, docs/BLOCK-GENERATION.md.

## Deterministic confirmed advantages

The workflow resolves one `requestedType` from explicit `task.blockType` or bounded intent inference. The same value restricts the request schema, appears in untrusted DATA and controls final type validation. An explicit type wins. Russian typo aliases remain routing hints and never factual authority.

For `advantages` only, a complete validated group of 3–8 independently saved structured Brief items is server-owned card copy. Every fact must have the same immutable Brief version and contiguous `item:{index,count}` provenance; duplicates and partial/mixed groups fail closed. Exact owner-saved values are pinned verbatim, including complete conditions, negations and scope. The backward-compatible path also accepts a complete legacy fragment group produced by the existing closed grammar.

After the raw model plan passes Content schema, resource, text-security, single-section/type and CTA checks, the server pins those exact values. It then omits only optional heading/text fields that deterministic grounding rejects and replaces a rejected required pageTitle with the neutral server label «Преимущества». Neutral and grounded model copy stays unchanged; an exact allowlisted CTA remains under its separate desiredActions authority. Final schema/CTA/grounding validation runs again. Developer and Block QA receive only this final plan. Model synonyms or unsupported commercial wording cannot replace the stored facts, and unsafe/schema-invalid provider output cannot be hidden by pinning or cleanup.

Pinning is disabled for legacy whole-field facts, mixed Brief versions, non-contiguous/incomplete/duplicate provenance and groups outside 3–8. Conditional or negative structured items are permitted only as their complete exact cards and cannot authorize shortened positive copy. User instructions and creative/market/competitor/SEO context remain non-authoritative. If pinning is unavailable, the existing single grounding correction remains unchanged. Maximum requests and provider fallback behavior do not change.
