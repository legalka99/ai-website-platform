# Kleo Security Foundation

15 сентября 2026. Implemented означает работающий код с локальными тестами. Partially implemented означает политику/прототип без сквозной защиты публичного сервиса. Planned означает будущую работу.

## Границы доверия

Internet → Reverse proxy / WAF (Planned) → Authentication / rate limit (authentication Planned, rate policies Implemented) → Backend API (Planned) → Authorization / project isolation (policy Implemented, API/storage enforcement Planned) → Business services → AI / Integrations / Storage → Secrets layer.

`packages/security` не зависит от AI prompts, UI, CMS SDK или web framework. Оно содержит общие серверные правила. `packages/ai` использует эти правила, а website-model, orchestration, persistence, rendering и integrations остаются отдельными слоями. Политики в одном процессе **не изолируют скомпрометированный Node.js-код от памяти или process.env**. Реальное разделение процессов, service identities, сеть и минимальные права инфраструктуры обязательны до production. Цель текущего этапа — явные проверяемые границы для штатных вызовов и запрет лишних возможностей модели.

## Реализованные модули

| Модуль | Поведение | Предел текущей реализации |
|---|---|---|
| secrets / local-env | SecretProvider, local/test store, scoped credential refs; проверка project/org/provider при чтении; серверный CredentialService; `.env` owner-only | Нет Vault/cloud manager, физической изоляции или автоматической ротации |
| redaction / logging | Известные секреты, ключи, Bearer, private key, секретные поля; Error целиком исключается; allowlist metadata; error/warn/info/debug, debug выключен по умолчанию | Не детектор всех возможных секретов; event и metadata должны формироваться сервером; нет хранилища audit/оповещений |
| validation / prompt-policy | Ограничения размера UTF-8, строк, массивов, глубины/узлов и чужих прототипов; существующие схемы проверяют enum и unknown fields; данные отделены от инструкций | Нельзя считать текст фактически достоверным или полностью решить prompt injection |
| authorization | Actor, существующий User, Organization, ProjectMembership, Role, Permission; owner/admin/editor/viewer; deny by default | Actor и memberships должны поступать из доверенной сессии/хранилища; login/session отсутствуют |
| url-policy | HTTPS, ограниченный HTTP opt-in, блокировка private/special IP и metadata, userinfo, secret query params; все DNS A/AAAA; каждый redirect и лимит 3 (максимум 5) | Сетевой клиент не реализован; проверка сама по себе не защищает обычный fetch от rebinding |
| webhooks | Тестовый HMAC-SHA256 протокол, raw body, timestamp, constant-time comparison, одноразовый event ID, окно 5 минут | Не протокол Tilda/Bitrix; replay cache в памяти, нет HTTP маршрута |
| tools | Allowlist агента/тарифа/проекта/пользователя + authorization; обязательное approval опасных действий | Нет реальных инструментов или executor; контекст и approvals только от сервера |
| approvals | Draft → Preview → Approval → Execute, привязка к actor/project/org/tool/hash, 5 минут, однократное использование | Память одного процесса, нет UI, durable store и транзакции исполнения |
| files | Только PNG/JPEG/WebP, размер, extension/MIME/magic, отклонение traversal; случайное имя, quarantine metadata | Проверка сигнатуры не декодирует изображение и не исключает polyglot; файл не сохраняется |
| sandbox | Интерфейс лимитов; реализация по умолчанию всегда отказывает в исполнении | Изолированный runtime ещё не построен |
| http | HTTPS/secure cookies/HttpOnly/SameSite/CORS/CSP/HSTS/CSRF requirement/size config | Конфигурация не является middleware; API должен реально применить и проверить её |
| rate-limit | InMemoryRateLimiter: actor/IP/API-key-id/project/AI operation; AICostGuard: RPM, concurrency, output/workflow budget, max requests, retries=0 | Не распределённый лимитер, не биллинг; перезапуск обнуляет состояние |

## Использование в текущем AI

Серверная фабрика `createBusinessService` проверяет `actor → project → generate`, сверяет credential reference, получает ключ через SecretProvider и создаёт OpenAIProvider. Business Agent получает только `generate()` через GuardedAIProvider. В prompt не попадают SecretProvider, process.env, filesystem, shell, tools или metadata проекта. `projectId` не выбирает секрет самостоятельно: он сверяется с доверенным контекстом сервиса. Smoke использует эту фабрику с локальным владельцем и одним разрешённым вызовом. Это локальный bootstrap, не реальная аутентификация пользователя.

Прямой конструктор OpenAIProvider сохранён как низкоуровневый инфраструктурный адаптер и для тестов, не как будущая точка входа API. Новые серверные сценарии должны применять GuardedAIProvider и общий AICostGuard. Конструкторы не принимают запрос пользователя за доверенную конфигурацию. Одна общая инстанция guard на сервер; workflowId создаёт сервер. Нельзя создавать guard заново на каждый запрос или принимать actor, memberships, tool entitlements, secretRef, approvals из LLM/request body.

Business Agent использует общую политику DATA и ресурсную проверку структурированного результата перед прежним runtime validator. Usage после серверного сервиса содержит projectId/workflowId; execution.budget содержит reservation. На ошибках/таймаутах запрос и выходной бюджет не возвращаются в лимит: сервер мог уже обработать платный запрос. Бюджет ограничивает **выходные токены**, вход отдельно ограничен размером данных; это не точная цена и не общий финансовый лимит.

Стандартные AI limits: 10 запросов в минуту на проект, 2 одновременных вызова на shared guard, 5 запросов и 10000 зарезервированных выходных токенов на workflow, 2000 выходных токенов на запрос, 0 повторов. Smoke строже: один запрос, один конкурентный вызов, выходной бюджет равен настроенному максимуму. Заполненные state maps ограничены 10000 записями и при заполнении отказывают; workflow reservations намеренно не удаляются автоматически. Перед длительным сервисом нужен durable limiter/lifecycle, иначе перезапуск сбрасывает лимиты, а долгий процесс может исчерпать capacity. В будущем API применяет остальные измерения RateLimiter отдельно; сейчас автоматически подключён только AI project/operation limit.

OpenAI: store=false, maxRetries=0, fixed endpoint, redirect=error, timeout и отмена чтения тела, лимит тела 1 МиБ, сообщений 24000 символов, ограниченная schema, ключ не допускается в сообщениях/schema/model. Исходные API errors не выходят наружу. SafeLogger доступен будущим сервисам; текущий SDK по-прежнему ничего не логирует. Smoke выводит результат только через redaction. Запрос без `--confirm-paid-request` не отправляется; production/staging dotenv запрещён. Реальный API этим этапом не вызывался.

## Правила для будущих компонентов

- **Tenancy:** project-bound сущности, usage и workflow содержат projectId. Интеграции и refs содержат также organizationId. Сервер проверяет принадлежность каждого чтения/записи, а будущие storage adapters включают projectId в запросы и ограничения базы. Нельзя считать знание ID полномочием. CredentialService выполняет только доверенный код адаптера; callback нельзя выдавать агенту. Raw token отсутствует в IntegrationCredentialRef.
- **URL transport:** `validateDestination` возвращает immutable список разрешённых IP. Будущий клиент подключается к одному из этих IP без нового DNS lookup, сохраняет исходный hostname для TLS/SNI/Host, проверяет peer IP, отключает автоматические redirects и proxy overrides; каждый следующий URL валидирует заново, авторизацию между origin не переносит. Ограничить DNS/connect/read timeouts и объём загрузки. Нужна egress firewall. IPv6 политика намеренно консервативна: transition/special и весь 2001::/16 отклонены, возможны ложные отказы.
- **Webhook:** raw bytes захватываются до JSON parsing; лимит 1 МиБ. Тестовая подпись `HMAC(timestamp + '.' + eventId + '.' + rawBody)`; eventId подписан. В production provider-specific verifier и атомарный общий replay store с tenant/provider scope; проверка подписи не заменяет authorization последующей операции. Будущее время допускается только до 30 секунд для рассинхронизации часов.
- **Tools:** серверный registry, проверка ролей и обязательного уровня действия, allowlists. Опасные: publish, delete, external CMS write, domain change, credential change, external message, production deploy. Хэш считает сервер по точному сериализованному действию и данным предпросмотра (`previewDigest`). Approval относится именно к этим байтам и actor/project/tool. Реальная операция требует атомарной проверки/потребления approval и идемпотентности; в текущем прототипе решение потребляет approval, но ничего не выполняет.
- **Files/rendering:** результат validateUpload — метаданные карантина, не разрешение публиковать оригинал. Обязательны decode/re-encode, пиксельные лимиты, отдельное хранилище вне executable web root, непривилегированная обработка и изолированный preview origin. Не разрешать HTML/SVG/JS и не полагаться на исходное имя или Content-Type клиента.
- **Sandbox:** отдельные filesystem/process namespace/container/VM, без секретов, без сети и внутренней сети, минимальные права, CPU/memory/wall-time/process/output limits, уничтожение среды после запуска. До этого DisabledSandboxRunner остаётся единственной реализацией; AI output никогда не подаётся в eval/Function/child_process.
- **HTTP:** конфигурацию реально применяет будущий API; CSRF token и Origin checks для cookie mutations, доверенные proxy headers только от известного reverse proxy, проверка Host/HTTPS и строгий CORS. HSTS includeSubDomains включать после готовности HTTPS всех поддоменов. CSP для UI/preview проектируется отдельно; текущая конфигурация предназначена API.
- **Logging:** статические event names и минимальные server-generated metadata; никакого raw body/prompt/.env/Authorization. Явный local debug всё равно редактирует данные, безопасного режима вывода сырого prompt сейчас нет. Передавать известные секреты redactor на границе доверенного адаптера. Не прикладывать upstream errors к публичным ответам.

## Проверка и источники

Тесты работают offline с fake transport, store и verifier. Они подтверждают политики, а не защищённость несуществующего публичного API. Threat model, checklist и incident response дополняют код.

Основа правил: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html). Реализация использует встроенные Node crypto/net/fs; новых сторонних security dependencies нет.


## Постоянный Security-by-Design и public release gate

Обязательный источник требований: [Security Architecture](KLEO-SECURITY-ARCHITECTURE.md). **REQUIRED BEFORE PUBLIC LAUNCH:** полный авторизованный security review/pentest и AI Red Team, remediation и Retest PASS. Любой незакрытый Critical/High блокирует публичный запуск. Medium/Low требуют оценки риска, владельца, плана и срока. Gate сейчас документирован как процесс; автоматический CI gate не реализован.

Изоляция tenant обязательна для всех клиентских данных, AI context/history, credentials, usage/billing, logs, backups и artifacts. Сервер проверяет tenant/organization, project, actor permissions и ownership; client IDs не являются доказательством доступа. Least privilege обязателен для пользователей, сервисов, workers, agents, tools и integrations. Каждый tool call авторизуется отдельно.

**IMPLEMENTED:** существующие локальные provider guards, validation, redaction и ограничители запросов/бюджета в пределах текущего runtime. **PLANNED:** production auth/storage/infra enforcement, durable usage/cost controls, Kleo Sentinel и Red Team tooling. Sentinel дополняет deterministic guards, без произвольных destructive/admin/billing/secret полномочий. Для будущих AI workflows обязательны детерминированные лимиты шагов, вызовов/tools, retries/fallback, времени, входа/выхода, total tokens, cost и cancellation. Текущие и недостающие ограничения перечислены в Security Architecture.
