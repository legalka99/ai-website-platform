# AiVeron Owner/Admin Console v1

**Текущий checkpoint: Owner Write MVP.** Владелец может создать организацию, проект и сохранить структурированный бизнес-бриф из Console. PostgreSQL хранит неизменяемые версии брифа. Новые записи разрешены только `platform_owner`; `platform_admin` читает. Статус Sidebar — «Система активна», дизайн и пульс сохранены. AI workflow не запускается. Проверено **1130 PASS / 0 FAIL**: 938 ordinary + 35 persistence + 99 Auth/API + 56 browser + 2 сквозных browser/API/PostgreSQL сценария. Предыдущие checkpoint ниже описывают историю.

Следующий этап: **Workflow Launch + budget controls + status tracking**. Затем Preview → Tilda Integration → Beget staging; порядок deployment можно пересмотреть. Роли сотрудников отложены; требования безопасности перед публичным запуском сохраняются.

Base: clean `main`, `efb1bd6` (`feat: add auth api tenant foundation`). Previous checkpoint: 1002 tests. This is a read-only operational UI, except login/logout. No deployment, DNS changes, public registration, client cabinet, editing, publishing, role writes or AI execution. Kleo package names/imports remain unchanged.

## Stack and maintenance

`apps/web` was a package.json placeholder with no frontend code. React + TypeScript provide component composition, escaped text rendering and typed DTOs. Vite provides a small SPA build/dev toolchain without another application server. React Router owns `/admin` navigation/deep links; no custom router, SSR or framework implementation. No global store, data-fetching library, UI suite, chart/icon library or remote fonts.

Direct dependencies: React 19.3.0 / React DOM 19.3.0 (UI and DOM rendering), React Router 8.4.0 (routing); development: Vite 8.3.0 (build/dev server), @types/react and @types/react-dom 19.3.0 (TypeScript), @playwright/test 1.63.0 (real browser tests). Versions installed from current registry, exact resolutions in lockfile. Maintenance checked against [React releases](https://react.dev/versions), [React Router declarative documentation](https://reactrouter.com/start/declarative/installation), [Vite documentation](https://vite.dev/guide/) and [Playwright project](https://github.com/microsoft/playwright). Development requires Node 22.22+ (React Router engine requirement); verified locally with Node 26.8.2. No production Linux deployment was performed.

## Routes and sections

| UI route | Data and behavior |
|---|---|
| `/login` | Labeled email/password form, native validation, loading, generic errors |
| `/admin` | Actual DB counts (organizations/users/projects/workflows), 5 recent workflows, QA and security audit events |
| `/admin/organizations` | Paginated id/name/status/time; detail links |
| `/admin/organizations/:id` | Metadata and filtered projects/workflows links |
| `/admin/users` | Paginated safe id/email/status/platform role/time |
| `/admin/users/:id` | Safe account metadata; no sessions/hash or role changes |
| `/admin/projects` | Name/organization/status/created/updated, optional organization filter |
| `/admin/projects/:id` | Metadata and links to scoped workflows, Websites, versions, QA, usage |
| `/admin/workflows` | Run/project/status/start/end |
| `/admin/workflows/:id` | Metadata, up to 5 persisted stage executions, links to QA and per-attempt usage |
| `/admin/websites` | Website identity/project/draft status/time; link to versions |
| `/admin/versions` | Version number/identity/draft/source workflow/time |
| `/admin/qa` | PASS/FAIL, score, severity counts, code, validated message/recommendation |
| `/admin/usage` | Persisted provider/model/agent/attempt outcome/tokens/duration/time and workflow/project |
| `/admin/audit` | Safe security audit timestamp/actor/action/resource/request ID |
| `/admin/system` | Public API liveness, authenticated platform role; explicitly no DB readiness claim |

Counts use fixed DB aggregates under the existing transaction statement timeout; no client-side downloads to calculate totals. Dashboard data is a current read, not real-time monitoring. Global audit contains authentication/security audit events; workflow lifecycle events remain visible via workflow records, not merged into a misleading Sentinel feed.

Lists use 20 records/page, bounded offset in URL and server ordering. Existing API maximum 50 and offset 10000 remain enforced. No arbitrary sort/search. A full final page can expose Next followed by an explicit empty state (no invented total count). Deep history cursor pagination is future work. All pages have loading/empty/error/data states; no silent retries or polling. Null token counts display “Недоступно”, never 0. Monetary cost remains planned; no estimated money/margin is shown.

Desktop-first neutral green/stone theme, small centralized CSS tokens, reusable shell/header/table/badge/loading/error/metadata components. Keyboard focus, skip link, semantic tables/labels, textual status and horizontal table scroll are provided. Sidebar becomes horizontal navigation on narrow viewports. No WCAG certification claim. Dates retain backend timestamps and render in browser timezone, displayed in the footer.

## API integration and auth

Central `ApiClient` uses credentialed fetch, JSON, AbortSignal, no persistent frontend auth storage, no body logging. Startup reads `/api/v1/auth/me`; only platform_owner/platform_admin enter the shell. Organization users see access denied and can logout. Backend independently authorizes every request; UI gating is not a security boundary.

Password is transient form data, cleared from inputs on submission; never written to storage/URL/logs. Existing server cookie is used unchanged. CSRF token from `/auth/me` lives only in memory and accompanies logout. Login retains existing Origin protection. Logout clears server session and frontend state after success; failed logout is not presented as success. 401 unmounts the console and returns to login; 403 has no alternate endpoint bypass; 429/5xx show safe static errors, without upstream message/stack/SQL. Page changes abort pending requests; there is no cross-user data cache.

Dev API is fixed `http://localhost:3001`, UI `http://localhost:3000`; existing explicit CORS policy and same-site cookie behavior apply. Production build uses relative API paths for same-origin deployment. No arbitrary-host proxy. Vite does not load .env files (`envDir:false`); no server environment object is bundled. Actual `.env` is unchanged. The frontend never imports pg, persistence implementation, fs or provider modules; shared `packages/core/src/admin-api.ts` contains only browser-safe DTO types.

## Backend extensions

Existing admin list routes (users, organizations, projects, workflows) now use the explicit Console read projection. Users add permitted email/platform role, projects add timestamps. Existing auth, tenant repositories, Router, budget/cancellation/fallback and provider paths are unchanged.

Added GET endpoints, all under `/api/v1/admin`:

- `/dashboard`: fixed counts and bounded recent records, needed by overview.
- `/organizations/:id`, `/users/:id`, `/projects/:id`, `/workflows/:id`: metadata drill-down; workflow includes bounded execution timeline.
- `/websites`, `/versions`, `/qa`, `/usage`: paginated global metadata/validated QA projection for platform operators.
- `/audit-events`: paginated security audit projection.

Allowlisted optional filters: projects.organizationId; workflows.organizationId/projectId; websites.projectId; versions.projectId/websiteId; qa.projectId/workflowId; usage.projectId/workflowId. Multiple supplied filters combine with AND, all UUID validated and SQL parameterized. No role/userId authority filters. Missing detail = 404; valid filter with no match = empty list. Platform operators intentionally see multiple tenants via this explicit path. Normal tenant routes still have no platform bypass.

Every successful admin read, including dashboard/audit/detail, inserts platform_read inside the authenticated transaction before returning data. Failed audit causes rollback and safe 503. Existing audit resource vocabulary stays unchanged: original four kinds retain their resource type; Console aggregate/QA/usage/audit reads use `identity`, with server request ID correlated to safe route-template HTTP logs. More granular audit resource types require a future forward migration, not editing 002.

No new migration or edits to 001/002. `sql/api-grants.sql` adds column SELECT on executions/security audit and SELECT(document) on QA for validation. Existing deployments must explicitly apply the new GRANT statements as operator; the CREATE ROLE script is intended for initial setup, not blind replay. Runtime still cannot mutate credentials/roles or perform destructive admin actions. QA report document is never serialized wholesale: existing validator runs, only bounded code/severity/message/recommendation are projected. Invalid persisted QA fails closed. Website document access is not granted.

## Security review and boundaries

- XSS: no dangerouslySetInnerHTML, persisted HTML, markdown renderer or arbitrary href. API labels are untrusted text; React escaping remains active. Credential-looking labels are redacted server-side. QA uses the existing full validator.
- CSRF/CORS/cookies: existing policies remain unchanged. No insecure production cookie/proxy exceptions. Frontend adapts to them.
- IDOR/privileges: DB-backed session role checked for each read, explicit admin path, parameterized AND scope filters; user/org headers and URL manipulation cannot grant platform access.
- DTOs: no hashes, verifier, raw session token, auth headers, database URL, prompts, provider payloads, canonical Website JSON or raw internal errors.
- CSP: API defaults are unchanged. Stylesheets use external links: development does not require unsafe-inline or unsafe-eval. Scripts/styles stay self-only and connect-src allows only the fixed dev API/HMR endpoints. Production frontend policy allows self scripts/styles/connect, no inline/eval, no framing. Hosting must install equivalent response headers and safe SPA fallback. Vite preview is for inspection, not production hosting.
- Existing RLS gap remains: database login is trusted. No DB-isolation or public production readiness claim. Existing in-memory rate limits and aggregate timeouts remain; no distributed abuse controls added.

## Development and verification

With explicitly configured existing local PostgreSQL/API credentials (never frontend config), use two terminals:

```sh
npm run api:start
npm run web:dev
```

Open `http://localhost:3000/login`. Use an existing operator-provisioned platform account; Console does not create one or seed default DB data. Bootstrap guidance remains in AUTH-API-ARCHITECTURE.md. There is no public registration/password reset UI.

```sh
npm run typecheck
npm test
npm run test:persistence
npm run test:auth
npx playwright install chromium --only-shell
npm run test:web
npm run test:console:local
npm run web:build
node scripts/check-web-build.mjs
npm run security:check
git diff --check
```

Playwright browser download is a development tool installation, not an AI/provider call. Tests may set PLAYWRIGHT_BROWSERS_PATH to a writable cache. Traces/videos and automatic screenshots are disabled to avoid credential artifacts. Explicit screenshots contain only isolated fixture dashboards, under /tmp. `test:console:local` starts its own disposable Docker PostgreSQL, seeds only that isolated test DB, starts API with kleo_api restricted role and opens real browser flow. It refuses default/non-test DB configuration and cleans up on normal completion. Ports 3000/3001 must be free; it never reuses a running user service. Tests are offline with respect to AI; dependency/browser/container image installation may require network.

When the host sandbox blocks native Chromium IPC, `npm run test:console:docker` runs browser tests and full local smoke in isolated containers/network, with no host ports published. It copies only non-ignored source files to temporary staging, explicitly excludes .env files, and does not mount the real repository. Default test image is the official Playwright image. If that CDN is unavailable, an optional reproducible fallback uses the already-needed PostgreSQL base plus Debian Chromium and a supported Node runtime:

```sh
docker build -t kleo-console-browser:local -f scripts/console-browser.Dockerfile .
KLEO_TEST_SYSTEM_BROWSER=1 npm run test:console:docker
```

This image is test tooling only, not a deployment image. Node must be at least 22.22.0 for the installed React Router version. Temporary containers/network/source staging are removed after the run. For an interactive manual inspection, `KLEO_CONSOLE_INSPECT=1 npm run test:console:local` serves the same isolated fixtures until Ctrl+C; this never seeds the default DB.

## Limits and next stage

No destructive/write admin actions, workflow execution, roles management, public registration, reset/MFA UI, client cabinet, preview/editor/publishing or billing. User detail has account metadata only; membership drill-down is not added. Project related records use paginated links rather than loading all histories. Workflow usage lives in the linked filtered table; absent stages are not fabricated. Counts are not an analytics system.

Before production: deployment/same-origin TLS and frontend security headers, MFA/recovery, production role provisioning, session retention, distributed rate limits, DB defense-in-depth/RLS, backups, monitoring and formal security review/pentest/remediation. The Console working locally does not satisfy these gates.

One next stage: administrator account protection (MFA + recovery/session management), before public exposure. Not implemented here.

## Final verification and files

Baseline 1002 preserved. Final automated total **1056 PASS, 0 FAIL, 0 skipped**: 913 ordinary + 35 PostgreSQL persistence + 75 PostgreSQL Auth/API + 32 browser UI + 1 end-to-end browser/API/PostgreSQL smoke. Added 21 API/admin tests, 32 UI tests and one end-to-end test. Existing tests were not removed or weakened. `npm run typecheck`, production frontend build (Mac and Linux), `npm run security:check`, secret scan (findings `[]`), generated bundle scan (findings `[]`) and `git diff --check` passed. `.env` remains ignored (`!! .env`) and unchanged; HEAD remains efb1bd6; no commit.

Native Playwright startup was blocked by the macOS sandbox's Mach-port policy. Final browser tests ran successfully in the isolated fallback Linux image with Node 22.22.0 and Debian Chromium 152, using `KLEO_TEST_SYSTEM_BROWSER=1 npm run test:console:docker`. This command executes the real `test:web` suite, then local smoke, typecheck, build and bundle scan. Initial environment/setup failures are resolved; they were not UI assertion failures. Argon2 authentication was exercised in the Linux smoke as well as the Mac DB tests.

An additional interactive smoke through the in-app browser verified real owner login, Dashboard, organizations, users, projects, workflows, Websites/versions, QA, usage, audit, System, logout and normal tenant access denial. Desktop and narrow layouts were visually checked. Automated coverage includes XSS text rendering, generic credential errors, password/storage handling, 401/403/429/5xx, loading/empty/data, pagination, role gating, CSRF logout, typed safe fields, exact version→QA association and tablet layout. PostgreSQL checks cover owner/admin allowance, tenant denial, explicit audited reads, audit failure fail-closed, scope filters, bound/query rejection, safe projections and real persisted QA/usage. No external/live application service or AI provider was called; dependency/container downloads are development setup only. Tests seeded only disposable DBs; temporary servers/containers were stopped.

New files:

- `apps/web/index.html`, `apps/web/tsconfig.json`, `apps/web/vite.config.mjs`, `apps/web/playwright.config.mjs`
- `apps/web/src/api.ts`, `apps/web/src/app.tsx`, `apps/web/src/components.tsx`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `apps/web/src/tokens.css`
- `apps/web/tests/console.spec.mjs`, `apps/web/tests/local-smoke.spec.mjs`
- `packages/core/src/admin-api.ts`, `packages/persistence/src/admin.ts`
- `scripts/check-web-build.mjs`, `scripts/smoke-admin-local.mjs`, `scripts/test-console-container.mjs`, `scripts/test-console-docker.mjs`, `scripts/console-browser.Dockerfile`
- `docs/ADMIN-CONSOLE.md`

Modified files:

- `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `apps/web/package.json`
- `apps/api/src/server.ts`, `packages/persistence/sql/api-grants.sql`
- `scripts/test-persistence.mjs`, `tests/auth/api.test.mjs`
- `README.md`, `docs/KLEO-SPEC.md`, `docs/KLEO-DEVELOPMENT-PLAN.md`, `docs/AUTH-API-ARCHITECTURE.md`


## Branding / Theme

Current web branding is based on AiVeron Brand Assets v2 and can be replaced centrally. The Console is dark-only: blue-black layered surfaces, restrained metallic-blue accents, explicit status labels and visible keyboard focus. Login is a compact access form; all existing read-only routes, safe projections, auth and tenant boundaries are unchanged. No theme switcher, new UI dependencies, backend changes or migrations were introduced for branding.

### Approved assets

The source is the owner's `AiVeron-Brand-Assets-v2.zip`, extracted outside the repository. All archive SHA-256 checksums were verified. The supplied pack describes authorized reconstructed artwork; this integration uses those approved files unchanged and makes no claim of recovering an original vector. The canonical horizontal master is `01_MASTER/aiveron-logo-horizontal-master.svg`; symbol master is `01_MASTER/aiveron-symbol-master.svg`.

Only five files are shipped under `apps/web/public/brand/`:

| Web file | Source within pack |
|---|---|
| aiveron-logo.svg | 02_LOGO_SVG/transparent/aiveron-logo-horizontal-transparent.svg |
| aiveron-symbol.svg | 02_LOGO_SVG/transparent/aiveron-symbol-transparent.svg |
| favicon.svg | 04_FAVICON/favicon.svg |
| favicon.ico | 04_FAVICON/favicon.ico |
| apple-touch-icon.png | 05_APP_ICONS/apple-touch-icon.png |

The transparent horizontal lockup preserves the same metallic paths as the dark export while allowing the actual dark surface beneath it. There is no white backing, CSS recoloring, inline SVG, base64 or duplicate logo implementation. Selected SVGs were inspected for scripts, event handlers, embedded images and external references. ZIP, print/PDF/source artwork and screenshots are excluded from the production application.

### Central integration and replacement

`apps/web/src/brand.tsx` exports the full/symbol asset mapping and `BrandLogo`. Login, Sidebar and startup/denied states share it through the existing Brand link. Full logo is used in the current non-collapsing navigation; symbol is available for a future collapsed variant. Intrinsic proportions are preserved. `index.html` references official SVG/ICO favicon and Apple touch icon. Browser title is AiVeron Console; `main.tsx` derives theme-color from the single CSS canvas token.

`tokens.css` centralizes canvas/sidebar/surface/raised/hover colors, borders, text levels, brand/focus/button colors, labeled success/warning/danger/info states, spacing, radii, shadow and logo widths. `style.css` controls layout; no logo geometry or brand hex colors live in React components. No meaningful animations are introduced.

To adopt a future approved v3/v4:

1. Inspect and validate the new pack, then replace only the five selected public assets, preserving filenames where possible.
2. If names or intrinsic proportions change, update the central BrandLogo mapping/dimensions and favicon links, never duplicate assets across pages.
3. Adjust brand/theme tokens only if needed; do not recolor or reshape official SVG paths.
4. Run typecheck, browser tests, production build and `node scripts/check-web-build.mjs`; the latter verifies exact copied assets and rejects ZIP/PDF, local paths and known secret patterns.
5. Visually inspect Login, Sidebar, favicon, status labels and keyboard focus at laptop and narrow widths. Update provenance here. v2 is a replaceable working version, not an irreversible brand decision.

### Branding validation checkpoint

Baseline 1056 tests is preserved. Current total **1059 PASS / 0 FAIL**: 913 ordinary tests, 35 persistence PostgreSQL, 75 Auth/API PostgreSQL, 35 browser tests and one real browser → HTTP → restricted PostgreSQL smoke. Three new browser safeguards cover branding/asset availability/focus, logo proportions/responsive overflow, and text/status token contrast (at least 4.5:1). Existing XSS, role denial, logout, tables, QA and usage assertions are retained. Typecheck, production builds, security/secret scan and generated bundle scan pass. Screenshots use only disposable test fixtures; no provider calls, real credentials or production metrics are involved.

Dark UI does not establish production readiness. MFA/recovery, RLS decision, distributed rate limiting, monitoring, backups, deployment hardening, security review and pentest remain separate work.


Branding-only file delta over the pre-existing uncommitted Console:

- Added: `apps/web/src/brand.tsx`; five `apps/web/public/brand/` assets listed above.
- Updated: `apps/web/index.html`; `apps/web/src/{app.tsx,main.tsx,style.css,tokens.css}`; `apps/web/tests/{console.spec.mjs,local-smoke.spec.mjs}`; `scripts/{check-web-build.mjs,test-console-docker.mjs}`; this document.
- Deleted: none. Dependencies added: none. Earlier uncommitted API/Auth/Console work remains intact, based on `efb1bd6`.
- Visual review: rendered Login/Dashboard and Organizations, Users, Projects, Workflows, Websites, QA, Usage, Audit, System screenshots at 1440×900. Layout checks also cover 1024/768/500 widths. Screenshots remain outside the repository/build; only disposable fixtures are shown.


## Русский интерфейс и Финансы v1

Интерфейс панели владельца полностью русскоязычный: навигация, вход, выход, заголовки, таблицы, состояния, доступность, роли, статусы, сведения о процессах, QA и аудит. Общие словари и форматирование находятся в `apps/web/src/labels.ts`. Идентификаторы UUID/API/HTTP, названия провайдеров/моделей, QA issue codes и неизвестные диагностические коды сохраняются. Произвольные сохранённые названия, сообщения и рекомендации не переводятся автоматически и отображаются безопасным текстом. Даты и числа используют ru-RU; большие целые токены форматируются через BigInt без потери точности; NULL никогда не превращается в 0.

Строка «Только просмотр» находится непосредственно под логотипом в Sidebar. BrandLogo, SVG/favicon assets, tokens и правила размеров логотипа не изменены.

### Финансы: доступные данные и границы

Новый маршрут `/admin/finance` находится рядом с «Использование ИИ». На «Обзоре» добавлен компактный финансовый блок. Доход, расходы, прибыль и маржинальность показывают «Недоступно» с пояснением «Финансовый учёт ещё не подключён». Денежных DTO/records пока нет: отсутствующая сумма не подменяется нулём или вычисленным значением.

Раздел содержит три представления: «Использование ИИ», «По организациям», «По проектам». Первое показывает реальные сохранённые provider/model/agent/outcome, input/output/cached/total tokens, duration, timestamp, project/organization/workflow. Одна строка — попытка обращения к провайдеру; попытки fallback не считаются отдельными выполнениями агента. Страница не выдаёт сумму текущих 20 строк за полный итог и не строит ложные графики. Cached входит в input и повторно не суммируется. Неизвестные токены остаются «Недоступно», известный ноль сохраняется.

Организации и проекты показывают существующие безопасные метаданные и недоступные денежные показатели. Ссылки открывают уже существующие детальные страницы и scoped использование ИИ. Это не финансовая агрегация: Monetary Cost Accounting, Billing, Revenue/Profit/Margin отсутствуют до появления реального учёта.

Нового API endpoint, backend DTO, SQL, миграций или grants нет. Используются существующие `GET /api/v1/admin/usage`, `/organizations`, `/projects`: platform_owner/platform_admin only, unauthenticated 401, ordinary org user 403, параметризованные запросы, safe projections, обязательный platform_read audit в транзакции, fail-closed при отказе аудита, прежний rate limit. Ответы ограничены 20 строками на страницу, offset до 10000; frontend не скачивает все страницы и не пересылает произвольные query parameters. Auth/session/CSRF/CORS/cookies/tenant enforcement не менялись. Console остаётся только для просмотра, кроме входа/выхода.

### Будущий Cost Accounting — не реализован

Планируемая модель: AIProviderPrice/ModelPrice → CostSnapshot, RevenueEvent, ExpenseEvent, Invoice, Payment, ProjectCost и OrganizationFinanceSummary. Сейчас speculative таблицы не создаются. Денежные записи должны иметь currency code (например RUB/USD/EUR); суммы разных валют нельзя складывать без отдельной политики конвертации.

Будущая формула: выручка − стоимость AI provider − прочие затраты платформы/проекта = валовая прибыль; маржинальность = прибыль / выручка × 100. Пока нет подтверждённых денежных записей или корректного знаменателя, результат недоступен. Цены провайдеров не захардкожены. Стоимость execution должна фиксироваться историческим snapshot по действовавшему тарифу и валюте, включая отдельную политику cached tokens; сегодняшние цены не пересчитывают прошлые затраты.

Следующий предлагаемый этап: контракт Monetary Cost Accounting с версионированием тарифов и историческими cost snapshots. В этом ТЗ не реализуется.


Проверки этапа русификации/Финансов: **1069 PASS / 0 FAIL** (baseline 1059): 913 основных, 35 PostgreSQL persistence, 75 Auth/API PostgreSQL, 45 браузерных, 1 browser → API → PostgreSQL smoke. Добавлены 10 браузерных проверок для локализации, навигации, неизменной ширины логотипа 184px, role/unauthenticated denial, пагинации финансов, NULL/zero/large integer, empty/error states. Существующие XSS и security assertions сохранены. Typecheck, production build, security/secret scan, bundle scan и diff check PASS. Локальные снимки Login, Обзора, Финансов и основных разделов проверены при 1440×900; данные исключительно из одноразовых test fixtures.

Файлы этого этапа: новые `apps/web/src/{labels.ts,finance.tsx}`; изменены `apps/web/index.html`, `apps/web/src/{app.tsx,components.tsx,style.css}`, `apps/web/tests/{console.spec.mjs,local-smoke.spec.mjs}`, `scripts/test-console-docker.mjs`, README и актуальные записи ADMIN-CONSOLE/SPEC/DEVELOPMENT-PLAN. Backend/DB/brand assets/dependencies не менялись. `.env` не изменён, игнорируется Git. Live AI calls: none. Commit: none.


## Sidebar и Настройки — текущий этап

Навигация централизована в `apps/web/src/sidebar.tsx`: «УПРАВЛЕНИЕ СИСТЕМОЙ» (Обзор, Процессы, Сайты, QA, Использование ИИ, Аудит, Система); «КЛИЕНТЫ» (Организации, Пользователи, Проекты); «ФИНАНСЫ И ОТЧЁТНОСТЬ» (Финансы). Порядок и категории — информационная структура, не механизм авторизации. Сервер остаётся границей доступа; скрытие пунктов меню не выдаёт и не ограничивает permissions.

Под неизменным логотипом общий `ConsoleStatus` показывает «Только просмотр» и маленький декоративный индикатор. Пульс означает доступность открытого интерфейса, не состояние backend/БД, подписок или клиентов. Текст сохраняется независимо от цвета. `prefers-reduced-motion: reduce` отключает анимацию. В будущем реальные подписки, клиенты, health и usage могут подключаться сюда только из авторизованного API с явными состояниями loading/unknown/stale.

Внизу Sidebar находятся реальная платформенная роль из `/auth/me` и ссылка «Настройки». Email текущего аккаунта убран из TopBar и Sidebar; он доступен в профиле. Email других аккаунтов в существующем разделе пользователей остаётся частью его read-only данных. Кнопка выхода сохранена в TopBar. На desktop основное меню прокручивается независимо от нижней зоны; на узком экране категории располагаются горизонтально с прокруткой, роль/настройки доступны отдельной нижней строкой. BrandLogo, размеры, tokens и assets не изменены.

### Настройки

`/admin/settings` — Профиль; `/admin/settings?section=employees` — Сотрудники. `settings.tsx` получает существующий safe SessionView.user: только email и человекочитаемая роль выводятся явно. Отдельного источника истины/хранилища профиля нет. Произвольные поля DTO, hashes, tokens и credentials не отображаются; строки React экранируются.

«Сотрудники» — честный readiness state: отдельная employee-модель отсутствует, а admin users содержит клиентские аккаунты. Поэтому список всех users не выдаётся за сотрудников, профиль владельца тоже не превращается в фиктивную строку штата. Обозначены будущие ФИО, email, телефон, мессенджеры, роль и статус; отсутствующие значения будут «Не указано». Никаких fake rows, форм приглашения/блокировки/изменения ролей или лишних запросов admin users нет. Backend endpoints, DTO, SQL, grants и migrations не добавлены.

Профиль/сотрудники остаются read-only. ФИО, телефон, Telegram/WhatsApp, пароль, MFA и активные сессии требуют отдельных безопасных write-контрактов. Будущие EmployeeProfile (контактные данные/статус) и Access (роль/permissions/MFA/account state/sessions) должны быть разделены типами и серверными контрактами, а не объединены в произвольный JSON. Подробный roadmap — KLEO-DEVELOPMENT-PLAN.md.


Проверки Sidebar/Settings: **1077 PASS / 0 FAIL**, baseline 1069. 913 основных tests, 35 PostgreSQL persistence, 75 Auth/API PostgreSQL, 53 браузерных и 1 browser → API → PostgreSQL smoke. Добавлены 8 проверок: группы/порядок/роль/email, reduced motion, профили обеих платформенных ролей, честное состояние сотрудников, отказ ordinary user, безопасный вывод профиля и отсутствие лишних полей, доступность меню на 1440×900/1024×700/768×600/500×800. Сохранены прежние logo/XSS/finance/auth assertions. Typecheck, production build, security/secret scan, bundle scan, git diff check — PASS. Визуально проверены профиль/сотрудники на 1440×900 и 1024×700; скриншоты вне репозитория и сборки, только одноразовые test fixtures.

Файлы этапа: новые `apps/web/src/sidebar.tsx` и `settings.tsx`; обновлены `app.tsx`, `style.css`, оба browser test файла, screenshot copy list в `scripts/test-console-docker.mjs`, README, ADMIN-CONSOLE, SPEC и DEVELOPMENT-PLAN. Новых зависимостей, API endpoints, migrations и изменений backend/security/brand assets нет. Actual .env не изменён и игнорируется. Live AI calls: none. Commit: none.

## Owner Write MVP — контракт и хранение

База: `main`, `075f09c`, исходное дерево чистое; baseline 1078. Новых зависимостей нет.

Organization → Project → Business Brief. Существующие organizations/projects, статусы, AuthRepository и BusinessProfile остаются без замены. Новая migration `003_owner_inputs.sql` нужна, поскольку старые snapshots привязаны к workflow, а пользовательское задание существует до его запуска. `project_briefs` хранит immutable версии с server UUID, actor, timestamp, organization/project composite FK и уникальной парой project/version. `owner_commands` хранит immutable квитанции идемпотентности: actor + operationId, hash нормализованного запроса и небольшой результат. Старые migrations не изменены.

Бриф — user input, не Business Agent output. Поля: companyName (200), description (2000), productsOrServices (1500), targetAudience (1000), geography (500), websiteGoals (1000), advantages (1500), desiredActions (500), contacts (1000), notes (2000). Числа — максимальная длина строки. Обязательны companyName, description, productsOrServices, targetAudience, websiteGoals, desiredActions. Все ключи присутствуют; необязательная пустая строка нормализуется в null. Products/audience/goals/actions здесь являются текстом пользователя; будущий адаптер явно преобразует их в массивы BusinessProfile/вход агента. Отрасль не выдумывается.

| Endpoint | Request | Response |
|---|---|---|
| POST /api/v1/admin/organizations | operationId UUIDv4, name | id, name, status, created_at |
| POST /api/v1/admin/organizations/:organizationId/projects | operationId, name | id, organization_id, name, status, created_at |
| POST /api/v1/admin/projects/:projectId/brief | operationId, organizationId, expectedVersion, brief | id, projectId, organizationId, version |
| GET /api/v1/admin/projects/:projectId/brief | path UUID | snapshot: null либо id, organizationId, projectId, version, createdAt, brief |

POST выбран для добавления версии: существующие CSRF/CORS правила не расширяются. expectedVersion=0 для первого сохранения; stale version → 409. UUID, timestamps и active status назначает сервер. Название trim, required, максимум 200; одинаковые названия допустимы. Unknown/missing keys и неверные типы отвергаются, включая status/role/id в create body. Бриф ограничен 32768 байт на HTTP и 24576 байт нормализованного JSON; create payload ограничен общим 8192-byte лимитом. Все поля ограничены отдельно.

Только platform_owner пишет; platform_admin может читать бриф, ordinary roles получают 403 на эти admin endpoints. Старый tenant POST /projects не изменён и сохраняет прежнюю policy. Новый owner path не создаёт поддельные memberships. Frontend скрывает кнопки, но сервер независимо проверяет актуального actor. Проверяются active organization/project и соответствие вложенности. Неизвестные/архивные/неверно вложенные targets → 404. Нет generic object/table writes.

Session + CSRF + допустимый Origin обязательны для POST. Owner writes ограничены 20/min на actor, brief reads — существующим admin лимитом 30/min. Parameterized SQL и row locks защищают scope/version, advisory transaction lock защищает actor/operationId. Повтор того же ключа и нормализованного payload возвращает тот же результат; другой payload → 409. Frontend блокирует double submit сразу и сохраняет operationId для ручного повтора неизменённого payload после неизвестного результата; автоматических повторов нет. Receipt не содержит полный бриф. Retention receipts пока не реализован, нужен отдельный operational policy.

Write + audit + receipt фиксируются одной authenticated транзакцией. Audit failure откатывает всё; события organization_created, project_created, brief_saved содержат actor/requestId/resource/organization/project/time, без текста брифа и контактов. Brief event ссылается на project. DB failures → безопасный UNAVAILABLE, без SQL/stack/raw body. Существующие session expiry/revocation и transaction timeouts сохранены.

Новые runtime grants: INSERT(id,name) organizations; SELECT,INSERT project_briefs/owner_commands. Нет нового DELETE, DDL или UPDATE содержимого. На существующей базе оператор применяет migration и только новые GRANT statements из конца api-grants.sql; весь файл с CREATE ROLE повторно выполнять не следует. Тесты используют отдельные disposable databases, рабочая база автоматически не мигрировалась.

Текст только escaped React rendering; HTML delimiters/control characters, опасные URL schemes, распознаваемые secrets/credential URLs и явно помеченные password/banking fields отвергаются. Публичные телефон/email/http(s)/messenger контакты разрешены как неактивный текст. Это не универсальный детектор любого произвольного секрета: форма явно запрещает ввод паролей, ключей и банковских данных. Payload не пишется в logs/audit. Никаких provider credentials во frontend.

## Owner UX и дальнейшая связь с workflow

Организации → Создать организацию → карточка → Создать проект → карточка → Заполнить бриф. Форма содержит десять подписанных полей, required/maxlength, подсказки; optional blank сохраняется как null. Loading блокирует повторный submit, ошибки связаны с полями и получают focus, значения не теряются. Успех возвращает в карточку проекта. Карточка показывает заполненность, версию, значения и владельцу кнопку редактирования; повторное сохранение создаёт новую версию. Нет autosave, истории версий в UI и предупреждения о несохранённых изменениях.

Sidebar/лого/тема/роль/пульс сохранены; заменён только текст статуса на «Система активна». В будущем область может показывать system health, active clients/subscriptions; сейчас эти показатели не имитируются. Finance/Settings не расширены.

Следующий этап должен привязать WorkflowRun к точному immutable brief id с organization/project composite FK. Запуск обязан отдельно авторизовать owner и scope: нельзя подделывать membership или обходить существующие scoped repositories. Адаптер user brief → validated BusinessAgent input должен явно нормализовать scalar/array различия, передавать пользовательский текст как недоверенные данные и не превращать контакты в credentials/tools. После запуска цепочка: Brief version → WorkflowRun → BusinessProfile → Website → QA. В этом этапе binding и запуск не реализованы.

## Проверка Owner Write MVP

1130 PASS / 0 FAIL: 938 ordinary, 35 PostgreSQL persistence, 99 PostgreSQL auth/API, 56 browser, 2 real browser/API/PostgreSQL smoke. Browser write smoke проходит owner login → organization → project → brief → refresh → повторное сохранение версии → logout → ordinary user denied. Это автоматизированный реальный браузер с изолированной test DB, не live AI и не production data.

Покрыты unknown/oversized/empty/type/UUID validation, CSRF/Origin, owner/admin/user authorization, scope/archived resources, idempotency same/conflicting payload, concurrent submits, version conflict, immutable rows, composite FK, minimal runtime grants, audit fail-closed rollback для всех трёх writes, migration replay/checksum/rollback, безопасные UI errors и сохранение полей.

Новые файлы: core/business-brief.ts; persistence/owner-validation.ts, owner-writes.ts, migrations/003_owner_inputs.sql; web/owner-forms.tsx; tests/owner-input.test.mjs; web/tests/write-smoke.spec.mjs (пути src у исходников). Изменены API server, web app/sidebar/labels/styles/console tests/Playwright config, persistence grants, auth/persistence tests, local/docker smoke harness и README/SPEC/PLAN/эта документация.

AI calls, generation, preview, Tilda, billing, deployment и commit: none. Production readiness не заявляется.
