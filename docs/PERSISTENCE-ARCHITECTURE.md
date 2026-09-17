# AiVeron Persistence / Database Foundation

AiVeron — внешний бренд, aiveron.ru — зарегистрированный владельцем домен. Kleo остаётся внутренним именем codebase; packages/imports не переименованы. Домен не подключается. Этот слой не означает production readiness.

## Архитектура и границы

`packages/persistence` отделён от AI agents и Website Model. `WorkflowPersistence` задаёт операции startRun / finishRun / getRun; `PostgresPersistence` реализует их и scoped чтение истории, snapshots, versions, QA, executions, usage и audit. `runPersistedWorkflow` — opt-in серверная композиция существующего WebsiteWorkflowOrchestrator. Прежний workflow без persistence продолжает работать без БД. Агентам не передаются repository, SQL, pool или credentials.

Целевая БД — PostgreSQL 17: нужны реальные транзакции, foreign keys, уникальность, блокировки и JSONB. Используется `pg` 8.23.0 и development types `@types/pg` 8.23.1, без ORM/query builder. Явный SQL сохраняет видимость scope predicates и составных FK, не требует code generation. Все значения параметризованы; динамические SQL-фрагменты ограничены серверными константами. Транзакция выполняется на одном выделенном client, не через независимые pool.query вызовы ([node-postgres](https://node-postgres.com/features/transactions)). Составные FK обеспечивают согласованность принадлежности между строками ([PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)).

## Сущности

| Таблица | Назначение / ownership |
|---|---|
| users | Глобальная identity foundation: UUID, active/disabled, server timestamps. Без email, passwords, sessions и auth реализации |
| organizations | Tenant boundary, имя, active/archived |
| memberships | User ↔ Organization; owner/admin/member/viewer, active/revoked; уникальная пара organization/user |
| projects | Organization-owned, active/archived; не меняет прежний core Project contract |
| workflow_runs | Organization/project/actor, invocation key, running/completed/qa_failed/failed/cancelled, время и digest сохранённого результата |
| domain_snapshots | Неизменяемые BusinessProfile, DesignDirection, ContentPlan; discriminator business/design/content, validated JSONB, один kind на run |
| websites | Стабильная серверная identity Website внутри проекта, draft/archived metadata |
| website_versions | Неизменяемый canonical Website JSONB, номер версии, draft-only, source workflow |
| qa_reports | Валидированный QAReport и queryable passed/score; exact version + source workflow + organization/project |
| agent_executions | До пяти stage executions на run, completed/failed/cancelled и статический error code |
| ai_usage | До двух attempts на execution: provider/model, outcome, available usage, safe request ID |
| approvals | Foundation-only append record actor + exact version + approved/rejected. Нет approval API или разрешения publishing |
| audit_events | Append-only события жизненного цикла run, actor/scope/run/server time; без arbitrary metadata |

Queryable ownership, relations, lifecycle, score и counters — relational. Domain documents остаются JSONB с runtime validation перед записью; SQL проверяет базовую форму/размер, scope/status identity и связи. SQL не дублирует весь semantic validator. `schema_migrations` хранит версии и checksums.

## Изоляция и authorization

Каждая project repository операция требует `PersistenceScope {actorId, organizationId, projectId}` из доверенного серверного authentication context. UUID из клиентского body не является подтверждением identity. Перед чтением/записью БД проверяет активность user, organization, project и membership. Viewer может читать; member/owner/admin могут сохранять workflow; создание проекта требует owner/admin. Завершение run разрешено только создавшему actor. Membership сейчас organization-wide: все проекты организации доступны согласно роли; отдельный project ACL не реализован.

Проверка и операция выполняются в одной транзакции. Share locks на user/org/project/membership не дают конкурентному revoke/archive сменить право посередине операции. Все project-owned FK включают organizationId и projectId. QA дополнительно связан составным FK с source workflow конкретной версии. Знание чужого UUID не даёт доступ через repository; проверки выполняются также при idempotent replay.

`provisionOrganization` — привилегированный bootstrap port для server/operator, вне WorkflowPersistence interface. Он атомарно создаёт User, Organization, owner membership; это не registration endpoint. Передавать его клиенту/агенту нельзя. Будущий Auth связывает проверенную внешнюю identity с User. Legacy core/security types не заменены и не считаются проверенной сессией.

RLS пока нет. Составные FK предотвращают несовместимые ссылки, но не защищают чтение произвольным SQL. Поэтому pool и database login — trusted server capability, а production API/auth/session/tenant enforcement ещё необходимы. Опциональный operator-run `packages/persistence/sql/runtime-grants.sql` создаёт NOLOGIN group role с ограниченными SELECT/INSERT/UPDATE правами, без DELETE, DDL, provisioning, изменения membership roles или approvals. Логин и секреты создаёт deployment отдельно. Column-level UPDATE grants на identity columns нужны PostgreSQL row locks; SQL runtime остаётся доверенным и не sandbox для пользовательского SQL. Проверено отдельным DB test. Migration/provisioning credentials отделяются от runtime credentials при deployment.

## IDs, versioning и timestamps

Persistence IDs — server-generated UUID v4 (`crypto.randomUUID`, SQL default gen_random_uuid), не последовательные публичные идентификаторы. Selectors и scope валидируются. Page/block IDs уже созданы существующим Developer builder и сохраняются после строгой domain validation; это локальные ссылки внутри version document, не самостоятельная authority. Они не дают доступ без scope/version.

При первой записи создаётся новая Website identity. Корневой Website.id нормализуется к persistence website ID, projectId — к проверенному scope; исходный объект не мутируется. Website metadata timestamps и QA checkedAt устанавливаются сервером при сохранении, provider timestamps не принимаются как audit time. Исходный AI pipeline остаётся независим от persistence identity.

Для новой версии передаётся scoped `websiteId`. Row lock на Website сериализует вычисление следующего version_number; UNIQUE(website_id, version_number) — дополнительная защита. Current version определяется максимальным номером, mutable current pointer не нужен. Каждая версия связана с source workflow; наличие QA не подразумевается для технически прерванного pipeline. QAReport всегда привязан к точной версии. UPDATE/DELETE triggers запрещают изменение versions, QA, snapshots, executions, usage, audit и approvals. Это защита от обычных SQL mutations, не от DBA, способного менять schema/triggers.

Status версии только draft. Approval foundation, будущие preview/staging/publishing могут ссылаться на immutable version ID; published lifecycle, actual rollback/edit/publish API здесь не реализованы. Организации/проекты имеют archival status; repository не предоставляет delete. FK используют RESTRICT, разрушительного cascade нет. Privacy retention/удаление требуют будущей отдельной политики.

## Workflow, транзакции и идемпотентность

`startRun` создаёт running запись и audit event атомарно. Необязательный invocationId — UUID, созданный серверным coordinator до попытки сохранения. Повтор с тем же ключом в том же organization/project и для того же actor возвращает существующий run, включая concurrent retry. Без ключа каждый startRun намеренно создаёт новый запуск. Это foundation для retries, а не distributed job system.

`finishRun` повторно проверяет полный либо последовательный частичный state: Business/Design/Content/Developer/QA runtime contracts, grounding, copy reuse, project и QA refs. Secret-looking domain values отклоняются; persisted documents не исправляются молча. Ошибки проверки выходят как статический INVALID_INPUT. Затем под lock на run одной транзакцией сохраняются snapshots → Website/version → QA → executions/attempt usage → terminal status/digest → audit. Ошибка даже в последнем шаге откатывает всё, сохраняя running запись. Serialization/deadlock/constraint conflict возвращается безопасно, без скрытого retry.

Canonical digest строится только из валидированного state, нормализованной telemetry, status и выбранного websiteId. Повтор идентичного finish возвращает те же IDs без дублей. Иной результат для завершённого run — CONFLICT. Terminal runs нельзя переписать. Уникальные run/stage, execution/attempt, run/snapshot-kind, run/version и version/QA дополнительно защищают от дублей.

Валидный отрицательный QA — `qa_failed`: сохраняются WebsiteVersion и QAReport. Техническая ошибка — `failed`: сохраняется уже проверенный последовательный state; при Developer success и QA failure версия остаётся без QA. Cancellation — отдельный status; уже выполненные outputs/usage сохраняются, отсутствующий следующий stage обозначается cancelled. Arbitrary error messages и stack traces не сохраняются; только WORKFLOW_FAILED / STAGE_FAILED / CANCELLED.

Wrapper сначала сохраняет run, затем вызывает `createRunner(runId)`: server factory использует этот ID в Router context и telemetry. AI вызывается один раз, persistence не инициирует повторную генерацию. Исключение runner/factory санитизируется; ошибка persistence не маскируется под durable success. Для контролируемого retry завершения caller использует прямые startRun/finishRun и удерживает результат. Автоматического recovery после потери процесса, per-stage checkpoints, durable jobs/outbox и атомарности между внешним AI request и DB нет. После crash run может остаться running — нужен будущий reconciliation. Данные usage не являются durable budget reservation.

## Telemetry, secrets и logging

AgentExecution хранит stage/status/server time; attempts находятся в ai_usage с FK на execution/run/project/organization. Actor выводится через WorkflowRun. Сохраняются provider, model, outcome, requestId и доступные inputTokens/outputTokens/totalTokens/cachedInputTokens/durationMs, плюс server recorded_at. Проверяются scope correlations, числовые bounds и safe strings. Используются routing attempts, если они присутствуют; top-level usage не дублирует последнюю attempt. При отсутствии counts SQL NULL означает unknown, а не ноль. PostgreSQL bigint/numeric при чтении pg представлены строками, чтобы не терять точность.

Не сохраняются goal/prompts, raw responses, arbitrary metadata, headers, API keys, credentials, upstream errors/stack или provider timestamps как доверенное время. Shared references копируются; циклы, accessors/toJSON, hidden/symbol properties, неподходящие prototypes и resource overflow отклоняются без исполнения. Схемы не имеют поля plaintext credential. Будущие integrations должны ссылаться на существующий scoped SecretProvider, а не класть ключ в JSONB.

Repository не логирует строки или контент. Tooling выводит только статический статус и безопасную тестовую сводку; DB errors преобразуются без detail/query/connection string. Secrets передаются runtime-конфигурацией pool/оператором, .env автоматически не читается. Content classifiers — ограниченная защита от узнаваемых секретов, не универсальный DLP; публичный API всё равно обязан исключить secret-bearing input.

Подготовлена история для будущего admin/cost view. Pricing engine, invoices, payments, durable quotas/reservations, cost/margin расчёт, Admin Console, Sentinel runtime и integrations не реализованы.

## Migrations и локальный запуск

Version-controlled forward migration: `001_foundation.sql`. Runner использует transaction + advisory lock, ordered names и SHA-256 checksums. Повтор не применяет SQL заново; изменение уже применённого файла, пропущенная/неизвестная migration или ошибка SQL прерывают транзакцию. После deployment файлы не изменяются — только новые миграции. Реальный PostgreSQL test проверяет пустую БД, replay, checksum drift и DDL rollback.

Для изолированной проверки достаточно работающего Docker:

```sh
npm run test:persistence
```

Runner создаёт одноразовый PostgreSQL 17 container, случайный loopback port и случайный password только в памяти процесса/environment, без volume/host mounts. Он не использует production URL или credentials, применяет migrations, запускает DB tests и удаляет контейнер. Обычный npm test не подключается к БД. Не запускайте DB test file напрямую с production config. При принудительном убийстве runner возможен оставшийся контейнер с префиксом kleo-persistence-test — удалять следует только проверенный тестовый экземпляр.

Для отдельной локальной development DB есть `compose.persistence.yml`, порт только 127.0.0.1:55432 и отдельный named volume. Existing Docker setup не меняется. Задайте уникальный KLEO_DEV_DB_PASSWORD через безопасный локальный secret mechanism, не записывая пароль в tracked files и не выводя его. Затем:

```sh
docker compose -f compose.persistence.yml up -d
```

Для migration явно задайте PGHOST, PGPORT, PGDATABASE, PGUSER и секрет PGPASSWORD через окружение/secret manager и выполните:

```sh
npm run db:migrate -- --confirm-migration
```

Для Compose это host 127.0.0.1, port 55432, database/user kleo_dev. Runner требует явные host/database/user и opt-in; .env не загружает. Перед production закрепить одобренный image digest, TLS configuration, non-superuser runtime login и отдельный migration owner. Compose user для локального bootstrap не является production runtime ролью. Docker major tag 17 получает текущий patch; deployment обновления должны проходить контролируемую проверку.

## Реализовано, проверки и следующий этап

Реализованы schema, migrations, repository authorization, transactional workflow persistence, immutable versioning, safe telemetry/audit, scoped reads, server composition adapter и local/test tooling. Существующие 890 baseline tests сохранены. Новые unit tests проверяют input boundaries и отсутствие AI retry; отдельные PostgreSQL tests — schema/FK/status constraints, tenant/project/membership, immutable records, concurrent versions, idempotency, rollback, usage projection и полный пятиэтапный orchestrator с fake agents.

Не реализованы production authentication, API endpoints, project ACL/RLS, durable job recovery, encrypted backups/restore tests, retention, DB monitoring, production pool/TLS/role provisioning, durable cost guards, frontend, Admin Console, publishing, Redis/queues, Ollama и Sentinel. До public launch необходимы auth/storage isolation, infrastructure hardening, architecture/source/API/staging review, black-box pentest, AI Red Team, remediation/retest и Critical/High=0. Следующий логичный этап — **Auth + API + tenant enforcement**, отдельной задачей.

## Проверенная контрольная точка и файлы

Baseline 890 сохранён. Итог: 901/901 ordinary tests (11 новых) и 35/35 PostgreSQL tests, суммарно 936/936 PASS; fail/skipped/cancelled = 0. Typecheck PASS; security:check failures: []; secret scan findings: []; git diff --check PASS. Миграция проверена на пустой реальной PostgreSQL, также проверены concurrent/idempotent operations, rollback, composite FK и restricted role. Тестовые контейнеры удалены. .env не изменён и остаётся ignored. AI live calls, deployment и commit не выполнялись.

Новые файлы:

- `packages/persistence/package.json`
- `packages/persistence/src/contracts.ts`
- `packages/persistence/src/index.ts`
- `packages/persistence/src/migrations.ts`
- `packages/persistence/src/postgres.ts`
- `packages/persistence/src/validation.ts`
- `packages/persistence/src/workflow.ts`
- `packages/persistence/migrations/001_foundation.sql`
- `packages/persistence/sql/runtime-grants.sql`
- `compose.persistence.yml`
- `scripts/persistence-db.mjs`
- `scripts/test-persistence.mjs`
- `tests/persistence-validation.test.mjs`
- `tests/persistence/postgres.test.mjs`
- `docs/PERSISTENCE-ARCHITECTURE.md`

Изменены `package.json`, `package-lock.json`, `README.md`, `docs/KLEO-SPEC.md`, `docs/KLEO-DEVELOPMENT-PLAN.md`. Существующий AI/domain/security код и прежние тесты не изменялись. Новые direct dependencies — pg и development-only @types/pg; транзитивные зависимости зафиксированы lockfile.
