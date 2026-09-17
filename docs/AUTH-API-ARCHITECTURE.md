# AiVeron Authentication / HTTP API / Tenant Enforcement

Base: clean main, `d3267f8` (Persistence Foundation). AiVeron — публичный бренд; Kleo packages/imports остаются. Нет UI, deployment, DNS изменений или AI provider calls. Этот checkpoint готовит backend для первой Owner/Admin Console, но не является public production certification.

## Компоненты

`apps/api` теперь содержит Fastify server с явными route schemas, безопасными DTO, cookie parsing и server-generated request IDs. Fastify выбран вместо собственного HTTP framework: schema validation, bounded parser, timeouts и встроенный injection testing. Настройки сверены с [официальной документацией](https://fastify.dev/docs/latest/Reference/Server/). Новые direct dependencies: Fastify 5.12.5, @fastify/cookie 11.1.2, Argon2 0.45.1. Cookie plugin нужен для корректного parsing/serialization; Argon2 — поддерживаемая реализация password hashing, не самописная криптография. Точные версии транзитивных зависимостей зафиксированы lockfile.

`packages/security/src/password.ts` содержит hashing policy. `packages/persistence/src/auth.ts` — серверные auth/session операции, scoped HTTP read repositories и отдельный explicit admin read path. Существующие PostgreSQL workflow repositories и AI agents не получают auth secrets и не меняют поведение. Переиспользуются AuthorizationPolicy, HTTP defaults, InMemoryRateLimiter и containsSecret. `AuthRepository` — доверенная server capability, не объект из request body.

## Password / account model

Email: trim + lowercase ASCII lookup, bounded validated format, максимум 254 символа и 64 в local part. Dot/plus aliases не объединяются, Gmail-specific normalization отсутствует. DB UNIQUE(email) предотвращает гонки; email не входит в logs/audit. Internationalized email и verification — будущий этап.

Password: 12–128 UTF-16 code units, максимум 512 UTF-8 bytes, без NUL. Нет требований uppercase/special characters. Используется Argon2id v19: memory 65536 KiB, timeCost 3, parallelism 1, случайная salt библиотеки. Одновременно не более двух hash/verify operations на процесс; при переполнении безопасный отказ. Password hash хранится отдельно в auth_accounts, никогда не возвращается DTO. Native library реально проверена на текущем Mac/Node; [node-argon2](https://github.com/ranisalt/node-argon2) поддерживает macOS/Linux, но production Linux image ещё требует собственного CI/deployment теста.

Wrong password, unknown email и disabled user дают одинаковый INVALID_CREDENTIALS. Unknown email проходит Argon2 verification с dummy hash той же policy. Это уменьшает timing oracle, но не обещает математически одинаковое сетевое время. Rate limiting одинаково применяется к существующим и отсутствующим нормализованным email. Синтаксически невалидный input отдельно даёт INVALID_INPUT.

## Sessions и cookies

Каждый успешный login создаёт новый 32-byte random opaque token. В БД только SHA-256 verifier с domain-separation prefix; raw token временно находится в серверной памяти для Set-Cookie и затем у клиента. JWT, signed self-contained permissions и long-lived signing secret не используются. Token не возвращается JSON body, не логируется. Не более десяти неревокированных sessions на user; login под lock пользователя ревокирует более старые. История не удаляется автоматически.

auth_sessions: id, userId, unique token_hash, createdAt, expiresAt, revokedAt. Default absolute TTL 8 часов, server config ограничен 5 минутами–7 днями. GET не продлевает TTL и не изменяет lastUsedAt. Logout ревокирует текущую session и очищает cookie. Expired/revoked session и disabled user не авторизуются. В дальнейшем logout-all/password reset могут ревокировать строки по userId; endpoints пока нет.

Development cookie: `kleo_session`; production: `__Host-kleo_session`. Всегда HttpOnly, SameSite=Strict, Path=/, bounded Max-Age, без Domain. В production Secure обязателен и не имеет настройки отключения. CLI startup требует HTTPS origins и TLS key/certificate files; request guard отказывает insecure production transport. Development origins ограничены loopback. `X-Forwarded-For/Proto` не доверяются, trustProxy=false. Поддержка TLS-terminating reverse proxy потребует отдельной явной конфигурации и тестирования. Сейчас production listener принимает TLS непосредственно и привязан к loopback; публичный deployment не выполнялся.

## CSRF, Origin и CORS

Каждый POST требует exact allowlisted Origin и application/json. Login защищён Origin policy ещё до authentication. Все authenticated POST дополнительно требуют `X-CSRF-Token`, привязанный к конкретной session: HMAC-SHA256 с raw session token как ключом и фиксированным CSRF label. Библиотечные Node crypto primitives; CSRF value отличен от DB session verifier. Сравнение fixed-format токенов — timingSafeEqual. SameSite не является единственной защитой.

CSRF token возвращается login и GET /auth/me; он не является auth token и не позволяет получить session cookie. GET /me может восстановить CSRF для страницы после reload без изменения session. Токен другой session не подходит. Для logout тоже нужны Origin и CSRF.

Credentialed CORS предоставляется только явным origins. Нет wildcard, reflection неизвестного Origin или automatic localhost в production. Preflight разрешает только GET/POST и Content-Type/X-CSRF-Token; чужой Origin получает отказ без Access-Control-Allow-Origin. Host сверяется с apiOrigin. GET/HEAD не меняют business/auth state; admin reads записывают требуемый security audit.

## Identity и authorization

Каждый authenticated request по verifier загружает session, активного User, account и актуальную platform role из БД. Клиентские userId/role/organization headers не используются. Session/user rows удерживаются share locks до завершения операции; revoke/disable не может изменить их посередине транзакции. Роль и membership не кэшируются в session.

Organization roles сохранены: owner/admin/member/viewer. Owner/admin создают проекты; остальные роли читают доступные проекты. На project-read membership member отображается на существующий security editor role для AuthorizationPolicy. Organization/project/user должны быть active, membership — active. OrganizationId в query/body — только selector; source actor берётся из session. Project.organizationId читается из БД и проверяется по membership. Отсутствующий и чужой project дают одинаковый NOT_FOUND. List filters чужой organization возвращают пустой список. Nested website/version IDs также сверяются с тем же project/organization.

Platform roles — отдельная таблица platform_roles: platform_owner/platform_admin; отсутствие строки означает normal user. Organization owner не становится platform owner. Global access возможен только через `/api/v1/admin/...`, проверяется отдельно и записывает platform_read audit. Обычные tenant routes не имеют admin bypass: даже platform owner без membership не читает чужой project через них. Нет HTTP endpoints назначения ролей, destructive admin operations или hidden superuser headers.

## RLS: решение и границы гарантии

RLS **не включён**. Реализован реальный authenticated tenant enforcement на HTTP/repository boundary и существующие composite FK на принадлежность связей. SQL через скомпрометированный runtime login способен читать несколько tenants; это остаётся явно незакрытым DB defense-in-depth gap.

Проанализированные пути:

| Путь | Что требуется для корректного RLS |
|---|---|
| Login и session lookup до выбора organization | Изолированные auth tables/functions и доказательство identity без доверия к client actorId |
| Organization picker и пользователь с несколькими memberships | Actor-based policies, не один произвольный current organization |
| Tenant project resources | Membership + active account/org/project policies, FORCE RLS и неизменяемость context |
| Фоновые AI workers | Отдельная server identity/capability и lifecycle scope без browser session |
| Global platform reads | Отдельный проверенный admin execution path/DB role с audit, без generic bypass |
| Connection pool | Transaction-local context для каждого пути, reset при rollback/error и тесты reuse |

Частичное `organization_id = current_setting(...)` без согласованной модели для этих путей сломало бы legitimate reads либо создало опасный bypass. Нельзя считать SET LOCAL actorId доказательством identity при произвольном SQL доступе. Поэтому RLS отложен как отдельный проверяемый шаг; текущие handlers не используют connection-level tenant variables вообще. Все actor/scope значения передаются параметрами в рамках текущей транзакции, что проверено последовательностью разных tenants/admin на pool max=1. Это не тест RLS и не заявление о DB-level read isolation.

## HTTP routes и DTO

Все API routes — `/api/v1`; health — `/health`. List parameters: limit 1–50 (default 20), offset 0–10000 (default 0). Bounded offset выбран для небольшого foundation; глубокая история требует будущего cursor pagination. Неизвестные query/body fields отвергаются, coercion/removal отключены. UUID selectors — валидированные UUID v4. Сортировка фиксирована сервером.

| Method / route | Результат |
|---|---|
| GET /health | `{status: ok}`, без DB/env/internal details; это liveness, не DB readiness |
| POST /api/v1/auth/login | Body email/password; Set-Cookie + csrfToken |
| POST /api/v1/auth/logout | Body `{}`, revoke + clear cookie, success |
| GET /api/v1/auth/me | Собственные id/email/platformRole + csrfToken |
| GET /api/v1/organizations | Собственные active organizations: id/name/status/membership role |
| GET /api/v1/projects | Собственные active projects, optional organizationId filter |
| GET /api/v1/projects/:projectId | Scoped id/organization_id/name/status |
| POST /api/v1/projects | organizationId/name, проверка owner/admin, server UUID; без role/userId input |
| GET /api/v1/projects/:projectId/workflows | id/status/timestamps/static failure_code |
| GET /api/v1/projects/:projectId/websites | id/status/created_at |
| GET /api/v1/projects/:projectId/websites/:websiteId/versions | Версии: id/source workflow/version number/status/time |
| GET /api/v1/projects/:projectId/versions/:versionId/qa | QA metadata: version/run/passed/score/time |
| GET /api/v1/projects/:projectId/usage | Scoped provider/model/attempt/outcome/token counts/duration/time, без pricing |
| GET /api/v1/admin/users | Global id/status/created_at, без password hashes или account records |
| GET /api/v1/admin/organizations | Global id/name/status/time |
| GET /api/v1/admin/projects | Global id/organization_id/name/status |
| GET /api/v1/admin/workflows | Global run/project/org/status/time/static failure_code |

Lists возвращают `{data, pagination: {limit,offset}}`. Metadata используют явные поля, PostgreSQL bigint/numeric сохраняют строковую точность pg. Full Website copy, snapshots, QA issue text, audit payloads и credentials не выдаются этим минимальным HTTP API. Дополнительный admin drill-down можно добавить отдельным audited endpoint для конкретной UI задачи. Никакой GET не запускает AI. POST workflow, publishing, role mutation, public registration, reset/email/OAuth/MFA routes отсутствуют. Public registration закрыта, а не включена экспериментально. OpenAPI generator не добавлялся; route schemas machine-readable внутри Fastify, HTTP contracts перечислены здесь.

## Ошибки, лимиты и logging

Safe error: `{error:{code,message},requestId}`. Server-generated UUID игнорирует client request ID. Ошибки validation — 400, credentials/session — 401, permission/CSRF — 403, чужой/неизвестный resource — 404, conflict — 409, body — 413, media type — 415, rate — 429, DB unavailable — 503, unexpected — 500. Нет SQL, constraint names, stack, paths, credentials или exception.message. Реальный SQL permission failure и fake internal failure проверены.

JSON limit 8 KiB, login 2 KiB; password отдельно bounded. Request timeout 15s, connection timeout 10s, keepalive 5s; SQL statement timeout 5s и lock timeout 3s, transaction-local. Rate limiter: IP 120 requests/minute; login 10/minute по socket IP и hash нормализованного email; authenticated user 100/minute; admin reads 30/minute. Test config может уменьшить login limit, server validation ограничивает максимум 20. Map имеет существующий предел 10000 keys, expired buckets удаляются, overflow fail-closed. Forwarded headers не меняют IP. Multi-process/distributed anti-abuse, edge limits и cluster-wide quotas ещё не реализованы.

Fastify raw logger отключён. Единственный access-log projection: requestId, method, route template, status. Никаких request bodies, URL query values, Authorization/Cookie, password, session/CSRF tokens, email или Website copy. Pool asynchronous errors и CLI exceptions выводят статический текст. Это дополняет существующую redaction foundation, не открывает debug режим с raw payloads.

## DB, audit и runtime privileges

Новая immutable migration `002_auth_api_foundation.sql`; `001_foundation.sql` не менялась. Добавлены auth_accounts (unique email/hash), auth_sessions (unique token hash, TTL constraints и indexes), platform_roles (single owner partial unique index) и security_audit_events. Последняя отделена от workflow audit: login failure ещё не имеет organization/project/workflow, выдумывать scope нельзя.

Security audit append-only: bootstrap_owner, login_success, login_failure, logout, access_denied, platform_read, project_created. Только server actor/request IDs, фиксированный resource type и optional resource ID/time. Login failures не сохраняют raw email/password или различие unknown/disabled/wrong. Origin/body rejection до identity пишется только безопасным HTTP access log; authenticated permission/CSRF/tenant denials также в DB audit. Rate-limited requests не создают неограниченные per-attempt auth audit rows.

Session creation + audit выполняются одной транзакцией после повторной проверки account/user state. Logout/revoke + audit атомарны. Platform read не возвращает результат, если audit insert не удался. Denial audit выполняется после rollback отказанной операции. Bootstrap owner использует advisory lock, uniqueness и одну транзакцию account/user/role/audit.

`sql/api-grants.sql` — отдельная operator-run NOLOGIN group role kleo_api; логин/secret назначаются deployment operator. SELECT auth/session данных нужен verification, но HTTP DTO исключает hashes. Для WebsiteVersion/QA/usage SELECT ограничен metadata columns. INSERT разрешён только sessions/projects/security audit; UPDATE — revocation и минимальные columns для row locks. Нет credentials/role writes, arbitrary DELETE, DDL, Website edits или workflow generation. Runtime не может bootstrap owner. Existing kleo_runtime grants не расширены. Migration/bootstrap используют отдельную привилегированную connection. Runtime pool нельзя выдавать клиенту/LLM.

## Локальный запуск и bootstrap

`.env.example` содержит только names/placeholders. Actual .env не меняется и автоматически не загружается. Используйте существующий local PostgreSQL setup и explicit PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD из защищённой server configuration.

```sh
npm run db:migrate -- --confirm-migration
npm run auth:bootstrap-owner -- --confirm-bootstrap
npm run api:start
```

Bootstrap — отдельный explicit CLI. Он принимает bounded JSON `{email, password}` только через non-interactive stdin, например из password manager/защищённого secret producer. Не передавайте пароль в argv, shell history или tracked file; не запускайте команду с password echo. При terminal stdin CLI отказывает. Нельзя повысить существующий account через этот bootstrap; совпавший email/уже созданный owner — safe conflict. Raw password не печатается. CLI создаёт только platform owner, не organization/membership автоматически. Provisioning остальных accounts пока административная server/DB операция, не public registration. Получение секретов из platform secret manager при deployment остаётся operator responsibility.

API по умолчанию слушает loopback localhost:3001, разрешённый UI origin localhost:3000. В production нужны NODE_ENV=production, явные HTTPS KLEO_API_ORIGIN/KLEO_API_ALLOWED_ORIGINS и KLEO_API_TLS_KEY_FILE/KLEO_API_TLS_CERT_FILE. Session TTL — KLEO_SESSION_SECONDS. Нет insecure production fallback или доверия proxy headers.

## Проверки и ограничения

Final local verification: `npm run typecheck` PASS; `npm test` **913/913 PASS**; `npm run test:persistence` **35/35 PASS**; `npm run test:auth` **54/54 PASS**. Total **1002 PASS, 0 FAIL, 0 skipped** versus baseline 936: 12 new unit tests and 54 new Auth/API PostgreSQL tests. `npm run security:check` PASS, bundled secret scan findings `[]`; `git diff --check` PASS; `.env` remains ignored and unchanged. Real AI calls: none. Commit: none. Initial working tree was clean on main at d3267f8.

New files:

- `apps/api/src/config.ts`, `apps/api/src/index.ts`, `apps/api/src/server.ts`
- `packages/persistence/migrations/002_auth_api_foundation.sql`
- `packages/persistence/sql/api-grants.sql`, `packages/persistence/src/auth.ts`
- `packages/security/src/password.ts`, `scripts/bootstrap-owner.mjs`
- `tests/auth-foundation.test.mjs`, `tests/auth/api.test.mjs`
- `docs/AUTH-API-ARCHITECTURE.md`

Modified files:

- `.env.example` (safe placeholders only), `README.md`
- `apps/api/package.json`, `packages/security/package.json`, `package.json`, `package-lock.json`
- `scripts/test-persistence.mjs`, `tests/persistence/postgres.test.mjs`
- `docs/KLEO-SPEC.md`, `docs/KLEO-DEVELOPMENT-PLAN.md`, `docs/PERSISTENCE-ARCHITECTURE.md`

Baseline: 901 ordinary + 35 persistence = 936. `npm test` включает новые offline hashing/config tests и не подключается к БД. `npm run test:persistence` сохраняет все 35 прежних проверок. `npm run test:auth` создаёт отдельный одноразовый PostgreSQL, применяет 001→002 и запускает HTTP/Fastify integration tests под kleo_api role; no production DB. TLS тест использует временный локальный сертификат, удаляемый после проверки; это не production certificate/deployment.

Проверены credentials/unknown/disabled, raw token storage, expiry/revoke/logout/fixation, двусторонний tenant IDOR, nested resource checks, role downgrade/revocation, separate platform roles, audited global reads, audit-failure fail-closed, CSRF/CORS, bounds, headers, rate limits, forwarded-header spoofing, pool reuse, SQL errors, migration replay/checksum и runtime privileges. Старые migration tests обновлены только для числа файлов и имени synthetic failing migration; assertions rollback/checksum не ослаблены.

Backend готов для первой read-only AiVeron Owner/Admin Console: login/me, explicit admin lists и scoped metadata. UI не реализован. Для public clients нужны email verification, protected onboarding/legal acceptance, reset/recovery и MFA strategy, anti-abuse/monitoring, review auth flows, production TLS/proxy/roles/backups/retention и session cleanup. RLS/DB defense-in-depth, distributed rate limits, production Linux validation и отдельный security review остаются gaps. Обязательны staging review, black-box pentest, AI Red Team, remediation/retest, Critical/High=0. Нельзя считать эти локальные tests production certification.
