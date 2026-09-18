# Kleo

**Текущий checkpoint: Owner Write MVP.** Владелец может создать организацию, проект и сохранить структурированный бизнес-бриф из Console. PostgreSQL хранит неизменяемые версии брифа. Новые записи разрешены только `platform_owner`; `platform_admin` читает. Статус Sidebar — «Система активна», дизайн и пульс сохранены. AI workflow не запускается. Проверено **1130 PASS / 0 FAIL**: 938 ordinary + 35 persistence + 99 Auth/API + 56 browser + 2 сквозных browser/API/PostgreSQL сценария. Предыдущие checkpoint ниже описывают историю.

Следующий этап: **Workflow Launch + budget controls + status tracking**. Затем Preview → Tilda Integration → Beget staging; порядок deployment можно пересмотреть. Роли сотрудников отложены; требования безопасности перед публичным запуском сохраняются.

Owner Console: меню разделено на категории; профиль и read-only основа раздела сотрудников доступны в «Настройки». [Описание и ограничения](docs/ADMIN-CONSOLE.md).

Актуализация Owner Console: русский интерфейс и раздел «Финансы» (`/admin/finance`) с сохранённой телеметрией ИИ; денежный учёт пока не подключён. Размер и assets логотипа сохранены. Подробности: [ADMIN-CONSOLE](docs/ADMIN-CONSOLE.md).

**Current checkpoint: AiVeron Owner/Admin Console v1.** Read-only React/TypeScript interface for platform_owner/platform_admin: overview, organizations, users, projects, workflows/executions, Websites/versions, validated QA, persisted AI usage, security audit and API liveness. Existing cookie auth/CSRF and explicit audited admin authorization remain the boundary. [Console routes, local commands, tests and limitations](docs/ADMIN-CONSOLE.md). Start API with `npm run api:start`, UI with `npm run web:dev`; production bundle: `npm run web:build`. No deployment or production-readiness claim. Earlier checkpoint descriptions below are historical.

**Current checkpoint: AiVeron Auth / HTTP API / Tenant Enforcement Foundation.** Email/password authentication, PostgreSQL opaque sessions, CSRF/CORS, authenticated tenant metadata routes and separate audited platform-admin reads are implemented. [Contracts, endpoints, bootstrap and limitations](docs/AUTH-API-ARCHITECTURE.md). RLS remains deferred; application enforcement does not isolate arbitrary SQL through the trusted runtime DB login. Next: read-only Owner/Admin Console. UI, public registration and production readiness are not implemented. Earlier checkpoint descriptions and counts below are historical.

**AiVeron — внешний бренд (aiveron.ru); Kleo — внутреннее имя codebase. Текущий checkpoint: Persistence / Database Foundation.** Добавлен отдельный PostgreSQL repository layer: organization/project scope, immutable Website versions, связанный QA, snapshots, execution/usage/audit и атомарное сохранение workflow. AI agents не обращаются к БД напрямую. [Архитектура и локальная проверка](docs/PERSISTENCE-ARCHITECTURE.md). Auth/API, production tenant enforcement, recovery/backups и deployment ещё не реализованы. Следующий этап — Auth + API + tenant enforcement.

Проверено: **901/901 ordinary tests + 35/35 PostgreSQL tests, всего 936/936 PASS**; typecheck, security:check, secret scan и diff check — PASS. Ниже — подтверждённая предыдущая контрольная точка AI pipeline; её 890 тестов сохранены. Persistence DB tests запускаются отдельно через `npm run test:persistence`, обычный `npm test` не подключается к БД.

**Текущий статус — Real QA Agent:** Business → Design → grounded Content → Developer → QA реализованы через общий Router. Developer собирает canonical Website draft сервером; QA объединяет deterministic validation и bounded AI semantic review в валидированный QAReport. **890/890 offline tests PASS**. OpenAI/Yandex Developer и QA live smoke подтверждены владельцем: оба QA provider responses технически успешны, OpenAI verdict PASS, Yandex semantic verdict FAIL. Различие семантических оценок допустимо. [Контракт и границы QA](docs/QA-AGENT.md). Числа и следующие шаги в датированных разделах ниже отражают историю этапов.

PLANNED: renderer/preview, production storage operations, publishing, CMS integrations, SEO/GEO, Analytics, CRO/Experiments, durable billing/quotas, production auth/storage enforcement и Kleo Sentinel. Security Foundation не является production certification; публичный запуск требует изоляции API/storage, infrastructure hardening, security review, black-box pentest, AI Red Team, remediation/retest и Critical/High = 0.

Платформа ИИ-агентов для создания и развития сайтов. Первый сценарий — создание страниц по одной, редактирование блоков, предпросмотр и тестовый перенос в Tilda.

## Документация

- [Единое ТЗ и план](docs/KLEO-SPEC.md)
- [Собственная модель, защита и постоянное развитие](docs/KLEO-DEVELOPMENT-PLAN.md)
- [Исходная переписка](docs/archive/chat-1.md)
- [Продолжение разработки](docs/archive/chat-2.md)
- [Переход к работе в Codex](docs/archive/chat-3.md)

Архивы содержат исторические предложения. Актуальные решения и ограничения собраны в ТЗ.

## Что работает

- Контракты Business, Design, Content, Developer и QA.
- Универсальная модель сайта: страницы, блоки, дизайн-система.
- Последовательный workflow с накоплением результатов и остановкой при ошибке.
- Проверка структуры ответа каждого агента, принадлежности проекта, уникальности идентификаторов и согласованности QA.
- OpenAIProvider через официальный SDK и Responses API со строгим JSON Schema; заменяемый AIProvider и FakeProvider.
- DefaultBusinessAgent: разрешённые входные поля → структурированный ответ → существующий runtime validator.
- Security Foundation: общие политики доступа, секретов, URL, webhook, инструментов, файлов и лимитов; серверная граница Business Agent.
- OpenAI и YandexProvider за единым Router с контролируемым fallback и общей защитой бюджета.
- 901/901 обычных тестов и отдельно 35/35 PostgreSQL tests PASS; проверка TypeScript PASS.

Это ядро разработки с пятью реализованными агентами. Прежний workflow возвращает состояние в памяти; новая opt-in серверная обёртка сохраняет результат в PostgreSQL. Интерфейс, предпросмотр, экспорт и Tilda пока не реализованы. Код проверяет точные структурные соответствия и security policy, AI оценивает смысл. QA PASS не доказывает истинность бизнес-фактов, визуальное качество или готовность публичного сервиса.

## Проверка проекта

Нужны Node.js 22.22+ и npm (включая требования текущего frontend router). В текущем окружении зависимости уже установлены. На новом компьютере сначала выполнить `npm ci`.

```sh
npm run typecheck
npm test
```

Тесты не вызывают внешние ИИ и не требуют ключей. Компиляция тестов сохраняется в `.test-build`, исключённой из Git.

API запускается отдельно через `npm run api:start` с явной PostgreSQL configuration. В другом терминале `npm run web:dev` запускает Owner/Admin Console на localhost:3000. `npm run web:build` создаёт production frontend bundle; deployment не выполняется. Общий `npm run dev` не запускает оба долгоживущих процесса параллельно; используйте отдельные команды. См. [Console instructions](docs/ADMIN-CONSOLE.md).

## Следующий этап

В долгосрочный план включено обучение собственной фундаментальной модели с нуля. Защита сервиса, регулярное улучшение по проверенным результатам и возможность добавлять функции предусмотрены отдельным планом с этапами и критериями приёмки. Эти направления запланированы; обучение и фоновый мониторинг пока не запущены.

Проверить новым ручным Yandex Business smoke структурированный ответ, профиль и usage; прежний OpenAI smoke, по сообщению владельца, уже прошёл. Затем добавить утверждаемый план страницы, повторное использование дизайн-системы, сохранение проектов и интерфейс. Подключение реального API требует отдельной настройки доступа.

Ключи и пароли не добавляются в исходники, архивы или Git. Реальная публикация следует после предпросмотра и подтверждения пользователя.

## Первый реальный запрос Business Agent

В корне репозитория создайте локальный `.env` по образцу `.env.example`, если его ещё нет; существующий файл не перезаписывайте. В редакторе заполните `OPENAI_API_KEY` и `KLEO_AI_MODEL`. Установите права файла `600` (команда `chmod 600 .env`); smoke отклоняет чужой, доступный другим пользователям или символически связанный файл. Локальный smoke разрешён только в development/test. В staging/production нужен серверный SecretProvider, dotenv рядом с кодом запрещён. Ключ вводится только локально: не отправляйте его в чат, не включайте в исходники или Git. `.env` исключён из Git. Модель должна быть доступна вашему API-проекту и поддерживать Responses API и Structured Outputs; её доступность ещё не проверена. При отсутствии ключа скрипт выдаёт понятную ошибку.

После локальной настройки выполните из `/Users/kirill/ai-website-platform`:

```sh
npm run smoke:business -- --confirm-paid-request
```

Скрипт использует серверный createBusinessService, scoped SecretProvider и ограничение одного вызова. Это явное разрешение на один потенциально платный запрос с вымышленным учебным бизнесом. Без флага команда `npm run smoke:business` не отправляет запрос. Автоматические тесты проверяют только защиту запуска, FakeProvider и SDK с подставленным сетевым транспортом; реальный smoke test в них не запускается. Скрипт показывает профиль и расход либо безопасное сообщение об ошибке.

## Контракт и ограничения первого агента

`DefaultBusinessAgent` принимает существующий `AgentContext` с `projectId`, `goal` и `input`. В `input` необходимы явно заданные непустые `companyName` и `description`; остальные допустимые поля соответствуют BusinessProfile. При их отсутствии запрос не отправляется, возвращаются `MISSING_BUSINESS_DATA` и `missingFields`. Если данных для остальных обязательных полей недостаточно, ответ с неизвестными значениями не проходит существующий валидатор: возвращается `VALIDATION_FAILED`, без фиктивного профиля. Ошибка `AgentResult` теперь может не содержать `output`; успешный результат содержит проверенный профиль.

Все поля транспортной схемы обязательны, неизвестные строки представлены `null`, массивы — `[]`; дополнительные поля запрещены. После проверки схемы результат нормализуется и проходит доменную runtime validation. Явно введённые строки и непустые массивы имеют приоритет; география, преимущества и конкуренты сохраняются только из явно заданных массивов пользователя. `projectId` остаётся локальным контекстом, цель передаётся модели для обработки задачи. Произвольные поля и metadata не отправляются.

Провайдер использует фиксированный endpoint OpenAI, запрещает перенаправления и отключает повторы и логирование SDK. Таймаут по умолчанию 30 секунд, предел ответа 2000 токенов; значения можно ограниченно менять через `.env.example`. Ограничены длина входа и размер ответа (1 МиБ), поддерживается AbortSignal. Ошибки авторизации, API, сети, таймаута, отказа модели и некорректного ответа имеют безопасные сообщения без исходного ответа сервера. Инструменты модели не включены, полученный код не исполняется. Системная инструкция отделена от пользовательского текста; проверка похожих на секреты строк — дополнительная эвристика, а не универсальный детектор секретов. Не помещайте секреты в описание бизнеса.

Разделение инструкций и строгая схема уменьшают риск prompt injection, но не доказывают отсутствие всех атак или выдуманных фактов в свободном тексте. Профиль требует содержательной проверки человеком. `store: false` отключает хранение Responses для последующего получения; это не обещание отсутствия любых журналов на стороне провайдера.

В результате возвращаются provider, model, доступные input/output/total tokens, timestamp и durationMs. Неизвестный расход не подменяется нулём. Стоимость не вычисляется, долговременного биллинга нет; при обрыве связи или таймауте расход может быть неизвестен, даже если запрос обрабатывался сервером.

Реализовано в коде и проверено без сети: протокол запроса, схемы, ошибки, отмена, лимиты и защита ручного запуска. **Не проверены в этом этапе реальным API:** Design, качество фактов и производственная эксплуатация. Предыдущие adapters и оба Router route подтверждены владельцем. О прежних успешных OpenAI и ручном Yandex вызовах сообщил владелец.

Основа реализации: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) и [официальный SDK OpenAI для JavaScript/TypeScript](https://github.com/openai/openai-node).

## Security Foundation — текущий статус

**Implemented:** отдельный `packages/security`; redaction и structured logger; resource validation и DATA policy; scoped secret references и local/test store; authorization roles; URL/DNS/redirect policies; test HMAC webhook/replay; tool permissions и preview/approval; file metadata validation; default-deny SandboxRunner; HTTP config; in-memory rate/cost guards. Business Agent создаётся через серверную фабрику в ручном smoke; ключ разрешается только серверным слоем. Все 82 прежних теста сохранены, добавлены 83 проверки.

**Partially implemented:** policies без публичного API не обеспечивают сквозную изоляцию клиентов, SSRF, auth и безопасность uploads. Авторизация требует доверенной сессии, URL transport — закрепления проверенного IP, webhook — реального протокола и общего replay store, лимиты — общей серверной инстанции и будущего durable storage. Тесты с fake transport не доказывают защиту от компрометации самого процесса Node.js.

**Planned:** production secret manager, регистрация/MFA, middleware HTTP/CSRF, база с tenant enforcement, pinned HTTP client, безопасный renderer/preview, production sandbox, distributed limits, WAF/DDoS, backups и alerting. Реальные API этим этапом не вызывались.

```sh
npm run security:check
npm run security:audit
```

Первая команда проверяет ignore rules, `.env` metadata, простые границы исходников и секреты в текущих файлах, включая архивы; не выводит найденные значения. Это эвристики, не полный аудит или scan Git history. Вторая проверяет известные уязвимости через npm registry; автоматически ничего не обновляет. Новых сторонних зависимостей для security нет.

Документы: [границы и использование](docs/SECURITY-FOUNDATION.md), [checklist](docs/SECURITY-CHECKLIST.md), [модель угроз](docs/THREAT-MODEL.md), [инциденты и восстановление](docs/INCIDENT-RESPONSE.md), [приватное сообщение об уязвимости](SECURITY.md).

## Yandex и AI Router

Business Agent → service → AIRouter → GuardedAIProvider → OpenAI / Yandex. Выбор детерминированный по server policy/capabilities/health; агент не получает ключ, endpoint или конкретную модель для настройки запроса. Все прежние 165 тестов сохранены, всего 222. Новых сторонних зависимостей нет.

В `.env.example` добавлены YANDEX_API_KEY, KLEO_YANDEX_FOLDER_ID, KLEO_YANDEX_MODEL, timeout/output limits и KLEO_AI_PRIMARY_PROVIDER / KLEO_AI_FALLBACK_PROVIDER. `.env` не изменялся. Заполняйте значения локально, ключи не отправляйте в чат.

Один реальный Yandex Business smoke после локальной настройки:

```sh
npm run smoke:business -- --provider=yandex --confirm-paid-request
```

Существующая команда без `--provider` по-прежнему использует только OpenAI. Для выбора по router config укажите `--provider=router`. Резервная попытка в smoke требует также `--allow-fallback`; без него максимум один вызов. В обычной серверной RouterPolicy максимум две попытки, fallback выключен при пустой настройке. Каждая попытка расходует общий request/output budget, неизвестный фактический usage не выдумывается.

Fallback допускается после timeout/network/rate limit/явного HTTP 5xx. Ошибки доступа, scope, schema/контракта, cancellation и budget/security denial переключение запрещают. Новые paid calls этим этапом не выполнялись. Политики всех пяти типов задач подготовлены; реализованы Business и Design, остальные агенты ещё впереди.

[Архитектура, capabilities, ошибки, health, usage и команды](docs/AI-ROUTER.md). Benchmarks, другие провайдеры, self-hosted и динамическая маршрутизация остаются Planned.

## Контракт Design Agent

Подготовлен DesignAgentInput — совместимое расширение BusinessProfile с optional designPreferences и existingDesignSystem из Website Model. Поля DesignDirection и WebsiteWorkflowState не менялись. Для результата добавлены строгая schema и runtime validator: HEX-палитра, непустой ограниченный текст/массивы, запрет unknown fields, markup/code/URL и credential-looking данных. Небезопасный design останавливается до Content Agent.

Реализован DefaultDesignAgent через createRoutedDesignService → AIRouter → GuardedAIProvider. Входные настройки проверяются и передаются как недоверенные DATA; structured output проходит прежний validator. Общие authorization, scoped credentials, budget и fallback сохранены. Business → Design → Content подключён через createWebsiteWorkflowService; ручной Design smoke добавлен. Новых зависимостей нет. 351 тест проходит, прежние 327 сохранены. [Контракт, лимиты и ограничения](docs/DESIGN-AGENT-CONTRACT.md).

## Ручная проверка Design Agent

```sh
npm run smoke:design -- --provider=yandex --confirm-paid-request
npm run smoke:design -- --provider=openai --confirm-paid-request
```

Каждая команда — один потенциально платный запрос через Design service → AIRouter → GuardedAIProvider → adapter. Без флага подтверждения конфигурация не загружается и запрос не отправляется; неизвестные параметры отклоняются до этого. Автоматические тесты используют только подставной транспорт, не сеть. Применяется учебный профиль «Учебный пример Kleo». `.env` не меняется; настройки providers используются существующие. Лимит — одна попытка, один concurrent request, до 2000 выходных токенов; меньший config limit сохраняется. Fallback smoke не включает.

Вывод: проверенный DesignDirection, provider/model, project/workflow, доступные usage/requestId, routing decision/attempts и budget. Вывод строится по разрешённым полям с независимыми snapshots и redaction; prompts, headers, raw response и конфигурация не выводятся. Владелец подтвердил реальные Design smoke через OpenAI/Yandex и коммит 776fd1d. Прежние OpenAI/Yandex API и оба Router smoke подтверждены владельцем.

[Design: контракт и ограничения](docs/DESIGN-AGENT-CONTRACT.md). [Будущий учёт токенов, себестоимости и Admin Console](docs/USAGE-COST-ADMIN-PLAN.md): **PLANNED**, только telemetry foundation реализована; никаких billing/quotas/UI/pricing engines пока нет.

## Real Content Agent

Implemented: DefaultContentAgent, строгая schema/runtime validation существующего ContentPlan, routed-content-service, подключение к Business → Design → Content → Developer и ручной smoke. ContentAgentInput остаётся `{ business: BusinessProfile, design: DesignDirection }`; goal задаёт назначение страницы. Никаких HTML/CSS/React/Website blocks или внешнего SEO-поиска.

```sh
npm run smoke:content -- --provider=yandex --confirm-paid-request
npm run smoke:content -- --provider=openai --confirm-paid-request
```

Без paid opt-in конфигурация не загружается, сеть не вызывается. Используется учебный профиль стекольной компании и нейтральный DesignDirection; один запрос через service → Router → guard → adapter, до 2000 output tokens. Вывод — проверенный ContentPlan и безопасная telemetry без prompts/keys/headers/raw response. Реальные Content API-вызовы в этом этапе не выполнялись, .env не менялся.

442 offline теста проходят, новых зависимостей нет. Grounding задаётся системной политикой; CTA дополнительно должен точно совпадать с одним desiredActions. Фактическая точность live copy требует проверки человеком. [Точный контракт, лимиты и границы Content](docs/CONTENT-AGENT.md).

Planned: Real Developer/QA, SEO/GEO, persistence, client quotas, cost accounting и Admin Console. Telemetry сохраняет agentType=content и прежние связи для будущего учёта; финансовые движки и UI не реализованы.


Диагностика Content smoke: после INVALID_RESPONSE теперь доступен value-free `validationError {stage, path, rule}`. Request-specific wire schema согласована с exact CTA и проверками copy/CTA/FAQ внутри секции. Runtime/security ограничения сохранены. 457 offline тестов проходят; причина конкретного предыдущего live-отказа без его диагностики остаётся неизвестной. Подробности — docs/CONTENT-AGENT.md (раздел диагностики).


## Постоянный Security-by-Design и public release gate

Обязательный источник требований: [Security Architecture](docs/KLEO-SECURITY-ARCHITECTURE.md). **REQUIRED BEFORE PUBLIC LAUNCH:** полный авторизованный security review/pentest и AI Red Team, remediation и Retest PASS. Любой незакрытый Critical/High блокирует публичный запуск. Medium/Low требуют оценки риска, владельца, плана и срока. Gate сейчас документирован как процесс; автоматический CI gate не реализован.

Изоляция tenant обязательна для всех клиентских данных, AI context/history, credentials, usage/billing, logs, backups и artifacts. Сервер проверяет tenant/organization, project, actor permissions и ownership; client IDs не являются доказательством доступа. Least privilege обязателен для пользователей, сервисов, workers, agents, tools и integrations. Каждый tool call авторизуется отдельно.

**IMPLEMENTED:** существующие локальные provider guards, validation, redaction и ограничители запросов/бюджета в пределах текущего runtime. **PLANNED:** production auth/storage/infra enforcement, durable usage/cost controls, Kleo Sentinel и Red Team tooling. Sentinel дополняет deterministic guards, без произвольных destructive/admin/billing/secret полномочий. Для будущих AI workflows обязательны детерминированные лимиты шагов, вызовов/tools, retries/fallback, времени, входа/выхода, total tokens, cost и cancellation. Текущие и недостающие ограничения перечислены в Security Architecture.


## Content business grounding — 16 сентября 2026

Implemented: Content uses confirmed BusinessProfile and optional explicit businessFacts as source of truth; DesignDirection is not authority for business claims. Prompt/schema guidance and deterministic RU/EN high-risk claim validation complement existing runtime/security checks. Recognized unsupported commercial claims are rejected before state.content/Website Model, without retry or fallback. Missing facts are omitted or requested in notes; style is distinguished from company qualities. General factual truth is not proven by these checks.

576 offline tests pass, including both provider adapters with fake transport and grounding failures with preserved telemetry. New input constraints, exact supported risky clauses, safe derivations, diagnostics and limitations: [CONTENT-AGENT](docs/CONTENT-AGENT.md). No live requests, new dependencies or changes to Router/security guards. Real Developer/QA and Kleo Sentinel remain PLANNED; mandatory pentest and public Security Gate remain in force.
