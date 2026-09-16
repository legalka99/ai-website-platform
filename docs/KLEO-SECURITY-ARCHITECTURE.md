# Kleo: Security-by-Design, Security Gate и Sentinel

Обязательная архитектурная политика · 16 сентября 2026. Этот документ — единый источник новых требований; текущие реализации перечислены в SECURITY-FOUNDATION.md, выпускные проверки — в SECURITY-CHECKLIST.md. Политика не означает, что production infrastructure или аудит уже реализованы.

## Статусы и обязательный Security Gate

**IMPLEMENTED:** library-level authorization/scoped credentials, SecretProvider abstraction, resource/schema/runtime validation, DATA policy, redaction, bounded Router fallback, общий локальный rate/cost guard, cancellation на provider boundary, usage/attempt telemetry и offline tests. Tenant guards сейчас не равны сквозной защите будущих API/DB/storage. Content имеет проверку опасных инструкций в output; heuristics не доказывают защиту от всех jailbreak.

**PLANNED:** Kleo Sentinel, полноценный auth/session/API/storage enforcement, durable audit/quotas/cost accounting, billing и Admin Console, production security infrastructure. Sentinel и pentest framework этим документом не реализованы.

**REQUIRED BEFORE PUBLIC LAUNCH:** разрешённый полноценный security audit/pentest собственного развёрнутого Kleo, AI Red Team, устранение и повторная проверка находок, проверка фактических tenant/authorization boundaries, инфраструктурных и финансовых hard limits. Безопасность сопровождает каждый этап разработки, а не добавляется в конце.

Правило выпуска:

- **PUBLIC PRODUCTION LAUNCH = BLOCKED**, если не устранена хотя бы одна Critical или High vulnerability.
- Отсутствие зарегистрированных находок само по себе не открывает gate: обязательный аудит должен быть выполнен в утверждённом scope, исправления повторно проверены; **Retest → PASS**.
- Только после этого, при выполнении остальных release criteria, допускается **PUBLIC LAUNCH ALLOWED**. Medium/Low требуют documented risk, owner, remediation plan и deadline. Info фиксируются в отчёте.
- Риск-принятие или AI risk score не отменяют запрет Critical/High. Новая существенная уязвимость/изменение границы доверия требует пересмотра допуска и targeted retest.
- Владелец выпуска фиксирует версию/commit, scope, отчёт, residual risks, retest и решение. Сейчас gate является обязательным правилом процесса; автоматического CI/deployment enforcement ещё нет. Пройденные unit tests/secret scan не являются pentest или разрешением публичного запуска.

## Multi-tenant invariant

Клиент A не должен получать данные или выполнять действия над ресурсами Клиента B ни через UI/API, ни через worker, AI, tool, интеграцию, экспорт, cache, artifact или backup. Инвариант распространяется на projects, websites, pages, files, settings, AI context/history/prompts, workflows, usage/statistics, billing information, credentials/OAuth/integration tokens/secrets, logs/audit data, backups/artifacts, CMS connections и все прочие tenant-specific объекты.

Каждая операция проверяет **server-verified organizationId/tenantId + projectId + actor permissions + принадлежность самого объекта**, а не только object ID. Уровень scope соответствует объекту: organization-level объект не получает выдуманный projectId, но требует отдельного tenant-level разрешения. Parent/child ownership проверяется по всей цепочке. Tenant/project IDs из запроса — только недоверенные селекторы, не доказательство доступа. Сервер выводит actor/tenant context из проверенной сессии и memberships и проверяет каждый переданный userId/projectId/organizationId/workflowId/resourceId.

Инвариант обязателен также для background jobs, queue payloads, queries/joins, file URLs, search/cache keys, AI context assembly, telemetry reads, exports, backup restore и delete. Tenant/project scope должен сохраняться сквозь передачу между агентами. Cross-tenant data не включаются в prompts или логи. Глобальный доступ оператора Kleo — отдельная минимальная административная роль с аудитом; tenant owner не получает глобальных прав. Это критерий реализации и тестирования будущих слоёв, не обещание уже существующей полной изоляции.

## Least privilege

Минимальные права выдаются User, Admin, backend service, worker, AI Agent, workflow, tool, integration, CMS connector, webhook handler, OAuth application, database account и infrastructure service. Scope и срок действия ограничены конкретной задачей. AI Agent не наследует все права пользователя автоматически. Каждый tool call проходит отдельную deterministic authorization, resource/tenant checks, quota и required approval; ответ LLM не является разрешением.

Tenant credentials хранятся server-side, encrypted at rest в production secret manager, с logical tenant isolation, minimal scopes, revocation и audit. Raw keys/tokens не возвращаются frontend или модели. Где потребуется доступ к интеграции, агент может передать проверяемый credential reference, а разрешение секрета остаётся серверной операцией. Нынешние Business/Design/Content вообще не нуждаются в credential refs или raw credentials. Шифрованное production-хранилище сейчас не реализовано.

## Детерминированная безопасность AI, workflow и расходов

AI output всегда недоверенный input следующего этапа. Validation и permissions работают независимо от модели. Indirect injection из сайтов/HTML, документов, файлов, CMS, CRM, email и иных внешних источников рассматривается как полноценная угроза. Запрещены prompt/context extraction, credential exfiltration, cross-tenant context leakage, agent privilege escalation, tool abuse/unauthorized calls, workflow manipulation и исполнение unsafe generated code.

Будущие серверные limits: maxWorkflowSteps, maxAgentCalls, maxToolCalls, maxRetries, maxFallbacks, maxExecutionTime, maxInputTokens, maxOutputTokens, maxTotalTokens, maxCost; cancellation и controlled shutdown. Проверять infinite/recursive/cyclic workflow, agent loops, context growth, excessive provider/tool calls и uncontrolled retry/fallback. Решение LLM никогда не снимает hard limit. Сейчас реализована только часть: фиксированная последовательность workflow, bounded fallback, request/output/concurrency budgets и provider deadlines/cancellation. Полных token/cost/time/step limits ещё нет.

Usage учитывает input/output/total/cached tokens и связь client/organization/project/workflow/agent/provider/model. Tariff quotas, project/organization budgets, warnings 70%/90%/100%, hard limits, controlled shutdown, runaway-cost/anomalous-spend/abuse detection — обязательные будущие меры до предоставления соответствующих платных возможностей. Server code обеспечивает atomic reservation/settlement и лимит, а не LLM/frontend. Неизвестный usage не считается нулевым расходом; fallback — отдельная потенциально платная attempt. Технические smoke limits не являются тарифами. Детали финансовой модели остаются в USAGE-COST-ADMIN-PLAN.md.

## Программа разрешённого security review / Kleo Red Team

Последовательность: **architecture review во время разработки → source-code review → API security review → staging assessment → black-box pentest развёрнутого Kleo → отдельный AI Red Team → remediation → retest → Production Security Gate → public launch после устранения Critical/High**.

Kleo Red Team — PLANNED отдельный режим проверки Kleo как недоверенной внешней цели. Клиентская часть не считается trusted. Проверяются собственные разрешённые endpoints/интеграции с заранее согласованными scope, тестовыми tenants/data, ролями, временным окном, лимитами нагрузок/расходов, stop conditions, аварийным контактом, хранением доказательств и восстановлением. Сторонние providers/CMS не становятся целями атаки автоматически. Документ не запускает pentest, сеть или платные AI-вызовы.

| Направление | Обязательные проверки по мере реализации |
|---|---|
| Auth/session | Registration, login/logout, password reset, email verification, session handling/fixation/hijacking, cookie security, JWT validation, refresh tokens, rotation/revocation |
| Authorization | RBAC, IDOR/BOLA, horizontal/vertical privilege escalation, mass assignment, подмена userId/projectId/organizationId/workflowId/resourceId |
| Multi-tenant | Cross-tenant reads/writes/files/AI context/credentials/usage/billing/integrations; exports/cache/artifacts/backups и background jobs |
| API | Все endpoints, включая undocumented; malformed requests, parameter tampering, authorization/rate-limit bypass, replay |
| Web/data | XSS, CSRF, SSRF, SQL/NoSQL/Command Injection, Path Traversal, unsafe upload, CORS, security headers |
| Secrets | .env, API keys, access/JWT/OAuth tokens, cookies, provider/integration credentials, server secrets; отсутствие server-side secrets в frontend, source maps, responses и logs |
| AI | Direct/indirect injection из сайтов/HTML/documents/files/CMS/CRM/email; system prompt/context extraction, credential/context exfiltration, cross-tenant leakage, agent escalation, tool abuse, workflow manipulation, malicious content between agents, unsafe generated code |
| Workflow/cost | Loops/recursion/cycles, retry/fallback/tool/provider/context exhaustion, cancellation, time/token/cost ceilings, quota bypass и financial abuse |
| Billing | Plans/subscriptions/limits/feature entitlements, trial/trial abuse, unpaid access, payment status/plan/usage/quota manipulation; forged/replayed/duplicate/out-of-order payment webhooks |
| Integrations | Tilda/Bitrix/WordPress/future CMS, CRM/forms/email/messengers, OAuth/webhooks/third-party APIs: scope, ownership, state/replay, token isolation/revocation и audit |

Платные функции открывает только сервер после проверки entitlements и подтверждённого payment state. Frontend flags не дают прав. Billing integration пока PLANNED.

Обязательные сквозные сценарии:

1. Обычный user → API → чужой projectId → cross-tenant access → privilege escalation → backend → credentials/admin → AI provider/external integration.
2. Prompt Injection → Agent → Tool → Integration → Secret Exfiltration.
3. User → Workflow Abuse → Provider Calls → Token Exhaustion → Financial Damage.

Цель — доказать блокировку цепочек на независимых детерминированных границах, а не только успешное обнаружение Sentinel.

Finding format: severity Critical/High/Medium/Low/Info; vulnerability name; location; affected component; attack scenario; reproduction steps; impact; affected data/systems; root cause; concrete remediation; fixed code/reference where applicable; retest status. Доказательства обезличиваются и не включают secrets. Для tracking также owner, version/scope и deadline. Отчёт и retest хранятся приватно с контролем доступа.

## Kleo Sentinel — PLANNED

Отдельный realtime monitoring/detection/response layer, дополняющий защиту. **Не заменяет** Auth, RBAC, tenant guards, deterministic authorization, schema validation, SecretProvider, rate limits, hard budgets, WAF, API Gateway и database constraints. Эти механизмы должны работать при отключённом или ошибающемся Sentinel.

Источники минимальных security events: authentication/authorization, API Gateway/endpoints, tenant/project access, Router/Agents/workflows/tools, integrations/OAuth/webhooks, billing/subscriptions/usage/rate limiting, admin panel, files и security guards. Никаких полных prompts, secrets, raw provider responses или Authorization headers в events. Сбор требует минимизации, retention, ограничений доступа и tenant scope.

Risk Engine: actorId/userId/organizationId/projectId/sessionId/workflowId, IP, endpoint, tool, integration; device/session fingerprint только при допустимости и обоснованной необходимости. Результат: riskScore 0–100 и LOW/MEDIUM/HIGH/CRITICAL. Пороги версионируются в server policy. Score объединяет deterministic rules, anomaly signals, thresholds и AI analysis; не основывается исключительно на LLM-классификации. AI анализирует недоверенные events без privileged tools.

Policy-controlled response: log, alert, increased monitoring, throttle/rate limit, reject request, stop workflow/cancel generation, block tool, disable integration, revoke session, quarantine project, temporary user lock, reauthentication, admin review. Права, scope, срок блокировки, rollback/unlock, rate/action caps и условия эскалации задаются заранее. Critical автоматические действия допускаются только утверждённой deterministic policy; ambiguous/destructive decisions требуют admin review. Sentinel не может произвольно удалить tenant/production data, изменить billing, назначить Admin, прочитать secrets или поменять security policy.

Каждое решение оставляет audit trail: eventId, timestamp, actor, tenant, project, event type, detected signals, risk score, policy/version, action, outcome, correlation ID. Audit без secrets, с tenant-aware access, ограничением retention и защитой целостности. Алгоритм, event pipeline, хранилище, UI и reactions сейчас не реализованы.

## Применение к следующим этапам

Эти требования обязательны для Real Developer/QA Agents, DB, authentication, API, frontend, Admin Console, billing/usage, Tilda/Bitrix/WordPress/CRM/OAuth, tools, file processing и deployment. Для каждого этапа нужны threat-model update, negative tenant/permission tests, bounded resources и review границ доверия. В текущей задаче реализуются только узкий Content fix и regression tests; Developer Agent, Sentinel, pentest framework и production infrastructure не запускаются.
