# Kleo — единое ТЗ и план разработки

**Текущий checkpoint — Persistence / Database Foundation.** AiVeron — внешний бренд, aiveron.ru — домен владельца; Kleo остаётся внутренним именем packages/imports. Organization → Project → Workflow / Website / immutable Versions / QA / Usage реализованы в отдельном PostgreSQL слое. Scoped repository проверяет memberships и ownership, составные FK защищают связи, одна транзакция фиксирует terminal workflow result. Domain models и агенты не зависят от БД. [Архитектура, tests и ограничения](PERSISTENCE-ARCHITECTURE.md). Auth/API, production isolation/storage operations и Admin Console остаются будущими этапами; production readiness не заявляется.

Следующий раздел фиксирует предыдущий Real QA checkpoint; его baseline 890/890 сохранён. Текущие проверки: 901/901 ordinary tests и 35/35 реальных PostgreSQL tests, всего 936/936 PASS. Typecheck, security:check, secret scan и diff check — PASS; DB tests запускаются отдельно.

**Актуальная контрольная точка — Real QA Agent:** реализован Business → Design → grounded Content → Developer → QA. Developer: LLM layout proposal → server-built canonical Website draft, серверные IDs/даты и draft-only status. QA: deterministic validation + bounded AI semantic review → final validated QAReport. **890/890 offline tests PASS**. OpenAI/Yandex Developer и QA live smoke подтверждены владельцем; оба QA ответа технически валидны, OpenAI verdict PASS, Yandex semantic verdict FAIL. [Контракт QA](QA-AGENT.md). Ниже сохраняется история предыдущих этапов; текущий статус задаёт этот раздел.

Код проверяет факты соответствия: exact copy/CTA, presence/order секций, grounding policy, schema/IDs/slugs, status и project/tenant scope. Provider wire принимает только QA_AI_CODES для semantic business/design/content/SEO/UX/accessibility review и recommendations; server-owned codes модели недоступны. Полный QAReport сохраняет серверные и legacy findings. Minimum severity защищена сервером; error/critical запрещают passed=true независимо от score. QA read-only и не публикует Website.

Renderer/preview, production storage operations, API/auth/tenant enforcement, publishing/CMS, SEO/GEO, Analytics, CRO/Experiments, durable billing/quotas и Sentinel остаются PLANNED. Production readiness не заявляется: нужны infrastructure hardening, architecture/security review, black-box pentest, AI Red Team, remediation/retest и Critical/High = 0.

Версия 0.9 · 15 сентября 2026 · Владелец проекта: Кирилл

## Назначение

Kleo объединяет ИИ-модели и специализированных агентов в управляемые цепочки действий. Первый продукт — создание сайтов по страницам с последующим развитием и продвижением в Яндексе, Google и ИИ-поиске. Пользователь описывает желаемый результат в одном интерфейсе. Обучение собственной фундаментальной модели Kleo включено в долгосрочный исследовательский план. Для первой рабочей версии используются внешние модели; собственное предобучение требует отдельного этапа данных, экспериментов и ресурсной оценки.

## Зафиксированные договорённости

- Внешний бренд — **AiVeron**, домен aiveron.ru; **Kleo** пока остаётся внутренним именем codebase. Прежние названия AI Website Platform и «Создание сервиса» относятся к этому же проекту. Технический rebranding — отдельная задача.
- Начинаем с небольшой рабочей версии на Mac, затем переносим сервис на сервер.
- Страницы создаются по одной. Клиент выбирает тип страницы, получает предложенную структуру и может изменить её до генерации.
- Страница состоит из блоков. Изменение одного блока не должно переписывать весь сайт.
- Все страницы проекта используют общую дизайн-систему.
- ИИ-ядро отделено от сайта клиента и конкретной CMS. Внутренний формат сайта — Website Model.
- Первый внешний тест — аккаунт Кирилла в Tilda. Сначала собственный предпросмотр и экспорт, затем проверка доступного способа переноса в Tilda.
- В дальнейшем нужны Битрикс, WordPress и другие адаптеры, а также помощник по интеграциям с CRM, почтой и формами.
- Собственный хостинг сайтов и подключение доменов предусмотрены как развитие; сейчас полноценную CMS не строим.
- Коммерческая модель: «Создание сайта», «Продвижение», «MAX». Цены и лимиты не утверждены. Цифры в прежних ответах были примерами.
- Публикация: черновик → предпросмотр → проверка → подтверждение пользователя → публикация. Нужны история версий и возможность восстановления.
- Нужен дополнительный контроль результатов агентов, а не только проверка флага success.

## Новые направления развития — 14 сентября 2026

По запросу Кирилла в план включены четыре направления: собственная фундаментальная модель; защита от взломов и утечек; постоянное обучение и усовершенствование; редактирование и расширение функций. Подробные этапы, зависимости и критерии готовности — в [плане развития Kleo](KLEO-DEVELOPMENT-PLAN.md).

Защита и расширяемость закладываются в текущую разработку. Улучшения основываются на проверенных результатах и контролируемых выпусках. Обучение весов, память проекта и база знаний — отдельные механизмы. Общие меры из плана остаются запланированными; реализованные ограничения первого Business Agent перечислены ниже и не означают готовности всей системы защиты.

## Что считаем первой рабочей версией

Кирилл создаёт проект, вводит сведения о бизнесе, выбирает одну страницу и подтверждает структуру. Kleo получает реальные ответы ИИ, создаёт редактируемую страницу, сохраняет её и показывает предпросмотр для компьютера и телефона. После перезапуска проект доступен. Можно изменить отдельный блок, увидеть новую версию и экспортировать результат для теста на Tilda.

До этого рубежа не требуется публичный запуск, приём платежей, полноценное SEO-продвижение, несколько провайдеров или собственный хостинг сайтов. В пользовательском интерфейсе показываем только доступные функции; будущие услуги не выдаём за работающие.

## Пользовательский сценарий

1. **Мои проекты.** Список проектов и кнопка создания. Для локального пилота — один владелец; регистрация и изоляция клиентов нужны перед публичным запуском.
2. **Описание бизнеса.** Название, сфера, услуги или товары, аудитория, география, преимущества, цель страницы, желаемое действие посетителя. Контакты и ссылки — по необходимости. Неизвестные сведения нельзя заменять выдуманными фактами.
3. **Страница.** Тип, название и адрес. В пилоте достаточно главной и страницы услуги; последующие страницы используют ту же дизайн-систему.
4. **Структура.** Предложенные блоки можно добавить, удалить и переставить. Генерация использует утверждённый порядок.
5. **Оформление.** Выбор стиля и цветов; референсы необязательны. Сохраняем настройки для следующих страниц.
6. **Генерация.** Показываем текущий этап, результат или понятную причину остановки. Не изображаем выдуманные проценты готовности.
7. **Предпросмотр и правки.** Компьютер и телефон; редактирование текста/блока с сохранением версии. Результат, не прошедший QA, остаётся черновиком.
8. **Экспорт и интеграция.** Скачивание страницы и материалов. Tilda — первый проверяемый внешний сценарий. Подключение CMS запрашивается только когда оно действительно нужно.

## Цепочка агентов

| Этап | Вход | Результат |
|---|---|---|
| Business | Сведения пользователя | BusinessProfile: описание бизнеса, аудитория, услуги, цели |
| Design | BusinessProfile и настройки проекта | DesignDirection: стиль, палитра, типографика, принципы композиции |
| Content | Бизнес, дизайн, утверждённая структура страницы | ContentPlan: секции, заголовки, тексты, CTA |
| Developer | Бизнес, дизайн, контент, контекст страницы | DeveloperOutput: Website Model |
| QA | Сформированный результат | QAReport: замечания, оценка, решение |

Сегодня интерфейсы Content и Developer ещё не передают отдельный утверждённый план страницы, а Design принимает optional existingDesignSystem и учитывает его в prompt; загрузка из хранилища и семантическая проверка сохранения стиля ещё не реализованы. Это необходимая доработка для постраничного сценария, а не уже реализованная функция.

Оркестратор накапливает результаты. Ошибка останавливает дальнейшие этапы и сохраняет ранее проверенные результаты в возвращаемом состоянии. Сохранение на диск/в базу — отдельный следующий компонент. Повторные попытки и исправления должны быть ограничены по числу и бюджету; бесконечные циклы недопустимы.

## Контроль качества

Реализовано 14 сентября: проверка структуры ответов всех пяти агентов, принадлежности сайта проекту, уникальности ID и адресов страниц, статуса черновика и противоречивого QA. Проверка выполняется перед передачей результата следующему агенту. На текущем этапе проходят 442 offline теста: сохранены прежние 351, добавлена 91 проверка Content. Владелец подтвердил OpenAI/Yandex API smoke и оба Router route. Владелец подтвердил реальные Design smoke через OpenAI/Yandex и коммит 776fd1d. Content smoke и сохранение проектов ещё впереди.

1. Проверка структуры ответа каждого агента: типы, обязательные поля, вложенные данные и допустимые значения.
2. Проверка связи с проектом: результат не должен относиться к чужому projectId, повторять ID страниц/блоков или содержать конфликтующие адреса страниц.
3. Проверка содержания: соответствие запросу, факты о бизнесе, утверждённая структура и единый стиль. Одной схемой данных это не проверяется.
4. Проверка отображения: адаптивность, ссылки, кнопки, формы, доступность и отсутствие ошибок.
5. Итоговый QA: passed=true недостаточно, если отчёт содержит ошибки уровня error или critical.

Для форм отдельно проверяется реальная доставка заявки. Нарисованная форма без обработчика не считается рабочей. В тестах ИИ заменён тестовыми исполнителями; это не подтверждает качество реальных моделей.

## Архитектура

Интерфейс → Backend API → Оркестратор → Агенты → Провайдер ИИ.

Результаты → Project Engine → Хранилище проектов и версий → Предпросмотр / экспорт → Слой интеграций → CMS клиента.

Текущая структура репозитория:

- apps/web — место для интерфейса; приложение ещё не реализовано.
- apps/api — место для API; сервер ещё не реализован.
- packages/ai — контракты агентов, провайдер и оркестраторы.
- packages/security — общие серверные политики безопасности, local/test implementations и границы будущей инфраструктуры.
- packages/core — типы пользователя, проекта, задачи и тарифа.
- packages/website-model — страницы, блоки и дизайн-система.
- packages/integrations — место для будущих адаптеров.

Существующий Node.js/TypeScript-проект сохраняем. Next.js для интерфейса, PostgreSQL для данных, S3-совместимое хранилище для материалов и очередь задач обсуждались как целевая архитектура; этих компонентов в коде пока нет. Выбор конкретных версий и пакетов проверяется перед установкой.

Основные сущности следующего этапа: проект, сведения о бизнесе, дизайн-система, страница, блок, версия, запуск workflow, результат этапа, интеграция и права тарифа. У всех данных должна быть явная принадлежность проекту. Учёт пользователей и доступа обязателен перед многопользовательским запуском.

## План реализации и критерии готовности

| Этап | Результат | Как проверяем |
|---|---|---|
| 1. Единый контекст | Это ТЗ, архив переписок, название Kleo | Решения отделены от прежних предложений и от фактического кода |
| 2. Контроль ответов | Проверка контрактов пяти агентов | Некорректный ответ не попадает в следующий этап, предыдущие результаты сохраняются |
| 3. Первая модель | Реализованы OpenAI/Yandex, DefaultBusinessAgent и DefaultDesignAgent: строгая схема, runtime validation, безопасные ошибки, лимиты и usage | OpenAI/Yandex routes подтверждены владельцем; Design готов к ручному smoke |
| 4. Постраничный проект | План страницы, общая дизайн-система, сохранение и версии | Добавление второй страницы сохраняет первую и её оформление; перезапуск не теряет проект |
| 5. Интерфейс и предпросмотр | Полный локальный сценарий | Создание, правка блока, повторное открытие, компьютер и телефон |
| 6. Tilda | Проверенный экспорт/перенос на тестовую страницу | Возможности подтверждены на аккаунте, публикация только после просмотра |
| 7. Публичный пилот | Авторизация, изоляция клиентов, защита инфраструктуры, резервирование, лимиты, аудит безопасности и реагирование | Проверены чужой доступ, изоляция кода, восстановление и реагирование на инцидент |
| 8. Развитие | Продвижение, биллинг, другие модели/CMS, интеграционный ассистент и регулярное улучшение | Контрольный набор, метрики, версии, пробный выпуск и откат |
| 9. Собственная фундаментальная модель | Исследование → данные → малый эксперимент → ресурсное решение → предобучение с нуля → адаптация | Заранее заданные оценки качества, воспроизводимость, проверка данных и безопасности |

Владелец сообщил о настроенных локальных ключах и успешных прежних OpenAI/Yandex вызовах. OpenAI/Yandex adapters и оба Router route проверены live по сообщению владельца. Не сохраняем ключи в переписке или исходном коде; новые платные вызовы требуют отдельного подтверждения. Инструкция настройки локального `.env` и команда ручного запуска — в [README](../README.md#первый-реальный-запрос-business-agent).

## Неопределённости и исправления прежних формулировок

- Автоматическая запись произвольных страниц в Tilda не подтверждена. Нельзя обещать её по одному наличию API; сначала проверяем официальные возможности и аккаунт. Экспорт и управляемый перенос рассматриваем отдельно.
- Доступ к существующему сайту зависит от CMS и выданных прав. Универсальное подключение к любому движку не обещается.
- Продвижение и ИИ-рекомендации — направления продукта; гарантий позиций или упоминаний нет.
- Node, npm, Git и команда Docker обнаружены. Работа Docker-сервера, базы, внешнего репозитория и резервного копирования пока не проверена.
- Команды dev в apps/web и apps/api ссылаются на отсутствующие файлы. Запускаемого интерфейса пока нет.
- Первые 14 тестов проверяли механику цепочки. Они не доказывали готовность агентов или самого сервиса.
- Предложения начать с Битрикса, десятков тарифов и собственной CMS заменены более поздними договорённостями: Tilda для пилота, три направления подписки и небольшой первый сценарий.

## Первый Business Agent — реализовано 15 сентября 2026

Цепочка: AgentContext → DefaultBusinessAgent → заменяемый AIProvider → OpenAI Responses со strict JSON Schema → нормализация BusinessProfile → существующий validateWebsiteAgentOutput. Остальные агенты и архитектура оркестратора сохранены. FakeProvider и подставной транспорт официального SDK позволяют проверить поведение без ключей и сети.

Обязательные входные companyName и description не выдумываются: их отсутствие останавливает запрос. Явные строки и непустые массивы пользователя имеют приоритет перед моделью; география, преимущества и конкуренты берутся только из явно заданных массивов. Неизвестные обязательные поля не заменяются фиктивными значениями: возвращается ошибка с missingFields. AgentResult разделяет успешный профиль и ошибку без обязательного output. Схема не доказывает достоверность свободного текста — содержательная проверка остаётся необходимой.

Добавлены таймаут и отмена, лимиты входа/ответа/токенов, запрет повторов и перенаправлений, безопасные ошибки и отключённые логи SDK. Ключ не включается в prompt, посторонние поля и metadata отбрасываются; projectId остаётся локально. Пользовательские инструкции отделены от системных, инструменты и исполнение кода не используются. Это базовые ограничения, не гарантия защиты от всех prompt injection атак.

Конфигурация — локальный игнорируемый `.env`, шаблон `.env.example`. Реальный запрос запускается только командой `npm run smoke:business -- --confirm-paid-request` после настройки ключа и доступной модели. Повторов нет. Расход и модель возвращаются в execution.usage, стоимость не выдумывается, постоянного учёта пока нет. При сетевом сбое расход может остаться неизвестным.

**Проверено без реального API:** успешные и некорректные ответы, ошибки API/сети, таймаут/отмена, валидация профиля, отсутствие фиктивных обязательных полей и защита запуска smoke test. **Не проверено:** права API-проекта, доступность выбранной модели, реальные ответы/расход, устойчивость в production. На этапе первоначальной реализации ключ пользователя не настраивался и платные запросы не выполнялись. Позднее владелец сообщил о самостоятельной настройке и успешных ручных вызовах; актуальный статус нового Router указан ниже.

## Security Foundation — 15 сентября 2026

**Implemented:** общая redaction/logger, input/DATA policy, actor/project/org authorization, scoped SecretProvider и credential refs, URL/DNS/redirect validation, test webhook HMAC/replay, tool/approval policies, upload metadata, disabled sandbox, HTTP defaults и локальные rate/cost guards. Smoke теперь вызывает Business Agent через серверный createBusinessService и GuardedAIProvider; секреты получает серверный адаптер. BusinessProfile проходит прежний runtime validator. Все 82 прежних теста сохранены.

**Partially implemented:** tenant isolation, SSRF, webhook, auth, logging, uploads и cost protection имеют политики и offline tests. В одном Node.js процессе нет физической изоляции secrets при arbitrary code execution. **Planned:** реальная сессия и API enforcement, storage isolation, pinned transport/egress firewall, shared replay/approval/limits, production secret manager, WAF, sandbox runtime, backups и monitoring. Не считать интерфейсы защитой уже запущенного сервиса.

Права существующего локального `.env` ограничены до 600. Smoke проверяет владельца и права, по-прежнему требует paid opt-in и не запускался на реальном API в этом этапе. Провайдер дополнительно ограничивает схему и отменяет чтение зависшего ответа. Репозиторий и archives проверены на шаблоны secrets, dependency audit не выявил известных уязвимостей на дату проверки. Новых сторонних dependencies нет.

Подробности и обязательные правила для следующих агентов — [Security Foundation](SECURITY-FOUNDATION.md), [checklist](SECURITY-CHECKLIST.md), [threat model](THREAT-MODEL.md), [incident response](INCIDENT-RESPONSE.md). Следующий Design Agent должен использовать серверную авторизацию, общий cost guard, минимальный набор данных и существующий validation boundary. Подключение внешнего API остаётся отдельным подтверждаемым действием.

## YandexProvider и Router — текущий этап

Implemented: YandexProvider через официальный Chat Completions/json_schema с локальной валидацией; AIRouter выбирает OpenAI/Yandex по server policy, capabilities и local health. Путь: Agent → service → Router → GuardedAIProvider → adapter. Concrete model/key/endpoint не передаются агенту для настройки. Все попытки, включая fallback, проходят общий AICostGuard; по умолчанию максимум две. Auth/scope/validation/cancellation/budget errors не вызывают fallback.

Прежний OpenAI-only service/smoke совместим. По сообщению владельца, прежний OpenAI smoke и отдельный Yandex запрос вручную успешны. В актуальном задании владелец подтвердил реальную проверку обоих adapters и Router routes. В текущем этапе новые API-вызовы не выполнялись. Новых сторонних dependencies нет. Дополнительно закрыт обход echo-check через Unicode-escaped JSON; redaction/scanner понимают Api-Key.

Planned: benchmark runner и scores, другие провайдеры/self-hosted, динамическая маршрутизация. Design подключён к Router; Content/Developer/QA пока только имеют entries в policy. [AI Router](AI-ROUTER.md) фиксирует настройки, live-test команды и ограничения. Следующий шаг — отдельно разрешённый Yandex Business smoke.

## Design Agent: контракт перед подключением

Implemented: DesignAgentInput совместим с BusinessProfile и добавляет optional designPreferences/existingDesignSystem. DesignDirection сохраняет поля и тип в WebsiteWorkflowState; уточнены HEX colors и текстовые visualReferences без URL. Строгая доменная schema запрещает неизвестные поля/пустые значения и ограничивает размеры; runtime policy отклоняет разметку, code/URL/credential-looking output. Существующая граница workflow вызывает эту проверку перед Content.

Implemented: DefaultDesignAgent принимает проверенный DesignAgentInput, передаёт недоверенные сведения как DATA через AIRouter и возвращает только проверенный DesignDirection. Общая серверная фабрика сохраняет scoped credentials, authorization, cost guard и прежние правила fallback. Wire schema адаптирует optional поля через null; usage/routing/budget сохраняются. Implemented: подключение к WebsiteWorkflowOrchestrator через createWebsiteWorkflowService и ручной smoke:design (openai/yandex). Planned: загрузка и сохранение общей дизайн-системы; реальный Design smoke запускает владелец вручную. На этом этапе не генерируются HTML/CSS/контент/страницы и не выполняются реальные API-запросы. [Контракт и ограничения](DESIGN-AGENT-CONTRACT.md).

## Учёт usage и будущая экономика продукта

Implemented: optional server-owned actorId/organizationId/agentType, cachedInputTokens и безопасный requestId в usage; start timestamp/duration и snapshots попыток; WebsiteWorkflowResult.executions сохраняет доступную telemetry этапов даже при последующем отказе. Финансовое хранилище и durable ledger отсутствуют.

**PLANNED:** Client Token Quotas (месяц/тариф, предупреждения 70/90%, порог 100%, upgrade/packages); Cost Accounting по клиенту/проекту/workflow/агенту/provider/model/периоду; gross profit и margin; отдельная Admin Console для административных ролей; клиентский AI Credits/usage % UI. Технический smoke limit не является тарифной квотой. Подробные требования и ограничения — [Usage/Cost/Admin plan](USAGE-COST-ADMIN-PLAN.md). Эти модули сейчас не реализованы.

## Real Content Agent

Implemented: существующие ContentAgentInput `{business, design}` и ContentPlan сохранены по полям. Добавлены строгая schema, bounded plain-text semantic validation, DefaultContentAgent → createRoutedContentService → общий AIRouter/GuardedAIProvider → OpenAI/Yandex. Website service по умолчанию подключает real Content; runtime boundary не пропускает malformed output в Developer. Предыдущие state и telemetry сохраняются при остановке.

Content — структурированный секционный план с copy, не Website Model, HTML/CSS или публикация. До 10 секций, до 4 CTA, ограниченные строки/points/FAQ; явная политика grounding запрещает выдуманные факты и отзывы. CTA точно совпадает с desiredActions. Нужна человеческая проверка фактов реальной модели. [Контракт Content](CONTENT-AGENT.md).

Добавлен smoke:content для OpenAI/Yandex с paid opt-in и учебными business/design. Нет новых API-вызовов или изменений .env в этом этапе. Сохраняются usage/routing/budget и agentType=content; Client Token Quotas, Cost Accounting, Admin Console и Margin Analytics остаются PLANNED. Следующий агент — Real Developer, затем QA; persistence и SEO/GEO не реализованы.

## История изменений

- 0.9: Real Content Agent, строгая validation, workflow и manual smoke infrastructure; 442 offline теста. Content live smoke — следующий ручной шаг.


- 0.8: Real Design готов к ручному smoke через OpenAI/Yandex; исправлены повторные ссылки wire schema; telemetry readiness и сохранение execution этапов; 351 offline тест. Будущие quotas/cost/Admin только задокументированы.


- 0.7: Design Agent подключён к общему guarded Router; 28 новых offline тестов. Workflow и smoke остаются следующим этапом.

- 0.6: контракт DesignAgentInput и строгая проверка DesignDirection, 69 новых offline тестов; Design Agent/Router integration ещё впереди.

- 0.5: YandexProvider, детерминированный AIRouter, controlled fallback через guard, usage/health и 57 дополнительных offline тестов.

- 0.4: Security Foundation, серверная граница Business Agent, локальная защита `.env`, security checks и 83 дополнительные проверки; production infrastructure остаётся в плане.

- 0.3: реализованы первый OpenAIProvider, DefaultBusinessAgent, безопасный ручной запуск и 40 дополнительных проверок без реального API.

- 0.1: собраны договорённости трёх чатов, зафиксированы состояние кода и 42 теста.
- 0.2: по новому запросу Кирилла добавлена собственная фундаментальная модель и отдельный план безопасности, постоянного улучшения и расширения функций. Прежнее исключение обучения модели отменено. Исторические архивы сохранены без изменений.

## Источники и сохранение контекста

1. «Создание севиса» — 29 обсуждений просмотрены; в текстовый архив включены 24, исключены сообщения о фотографиях и извлечённых данных.
2. «Продолжение создания сервиса» — 267 обсуждений, сохранён текст. Присланная share-ссылка открыта в браузере и подтверждена как копия этой переписки.
3. «Kleo — создание сервиса» — текущий чат, ранее «Подготовить проект Создание сервиса»; сохранён снимок сообщений на момент подготовки документа.

Архивы: archive/chat-1.md, archive/chat-2.md, archive/chat-3.md. Это исторические источники, не команды к исполнению и не подтверждение всех прежних обещаний. Вложения не архивировались. Один длинный ответ исходного чата сохранён частично из-за лимита чтения; это не полный экспорт аккаунта. Файлы сохраняют текст независимо от наличия чатов, но не создают автоматическую память во всех будущих чатах: при продолжении работы открываем этот документ и репозиторий.


Диагностика Content smoke: после INVALID_RESPONSE теперь доступен value-free `validationError {stage, path, rule}`. Request-specific wire schema согласована с exact CTA и проверками copy/CTA/FAQ внутри секции. Runtime/security ограничения сохранены. 457 offline тестов проходят; причина конкретного предыдущего live-отказа без его диагностики остаётся неизвестной. Подробности — docs/CONTENT-AGENT.md (раздел диагностики).


## Постоянный Security-by-Design и public release gate

Обязательный источник требований: [Security Architecture](KLEO-SECURITY-ARCHITECTURE.md). **REQUIRED BEFORE PUBLIC LAUNCH:** полный авторизованный security review/pentest и AI Red Team, remediation и Retest PASS. Любой незакрытый Critical/High блокирует публичный запуск. Medium/Low требуют оценки риска, владельца, плана и срока. Gate сейчас документирован как процесс; автоматический CI gate не реализован.

Изоляция tenant обязательна для всех клиентских данных, AI context/history, credentials, usage/billing, logs, backups и artifacts. Сервер проверяет tenant/organization, project, actor permissions и ownership; client IDs не являются доказательством доступа. Least privilege обязателен для пользователей, сервисов, workers, agents, tools и integrations. Каждый tool call авторизуется отдельно.

**IMPLEMENTED:** существующие локальные provider guards, validation, redaction и ограничители запросов/бюджета в пределах текущего runtime. **PLANNED:** production auth/storage/infra enforcement, durable usage/cost controls, Kleo Sentinel и Red Team tooling. Sentinel дополняет deterministic guards, без произвольных destructive/admin/billing/secret полномочий. Для будущих AI workflows обязательны детерминированные лимиты шагов, вызовов/tools, retries/fallback, времени, входа/выхода, total tokens, cost и cancellation. Текущие и недостающие ограничения перечислены в Security Architecture.


## Content business grounding — 16 сентября 2026

Implemented: Content uses confirmed BusinessProfile and optional explicit businessFacts as source of truth; DesignDirection is not authority for business claims. Prompt/schema guidance and deterministic RU/EN high-risk claim validation complement existing runtime/security checks. Recognized unsupported commercial claims are rejected before state.content/Website Model, without retry or fallback. Missing facts are omitted or requested in notes; style is distinguished from company qualities. General factual truth is not proven by these checks.

576 offline tests pass, including both provider adapters with fake transport and grounding failures with preserved telemetry. New input constraints, exact supported risky clauses, safe derivations, diagnostics and limitations: [CONTENT-AGENT](CONTENT-AGENT.md). No live requests, new dependencies or changes to Router/security guards. Real Developer/QA and Kleo Sentinel remain PLANNED; mandatory pentest and public Security Gate remain in force.
