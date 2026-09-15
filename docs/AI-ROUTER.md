# Kleo AI Router и YandexProvider

Статус: Implemented в коде и offline tests. На этом этапе реальные платные запросы не выполнялись. Владелец сообщил об успешном прежнем OpenAI Business smoke и отдельном Yandex запросе из Terminal; это не проверка нового Yandex адаптера, JSON Schema или Router end-to-end.

## Границы

Agent → Business/Application Service → AIRouter → GuardedAIProvider → OpenAIProvider / YandexProvider.

Конкретные модели и credentials принадлежат серверной конфигурации. Business Agent получает абстракцию generate и технический маркер `route`, который Router заменяет реальной моделью. Агент не читает env, не выбирает провайдера и не получает ключ или endpoint. Диагностические usage/routing записи содержат provider/model для владельца сервиса.

`createRoutedBusinessService` проверяет actor/project/org и все credential references, затем получает ключи через SecretProvider. Каждый адаптер получает собственный GuardedAIProvider; всем guard передаётся **один общий AICostGuard**. Router принимает только guarded bindings и не имеет SecretProvider. Прежний `createBusinessService` сохранён как совместимая OpenAI-only обёртка; старые прямые вызовы AIProvider и явный model в конструкторе агента работают для инфраструктуры/тестов.

Настройки, actor, workflowId, policy, capabilities и credential references формирует доверенный сервер. Их нельзя брать из model output или тела пользовательского запроса. Config/testAdapter/transport injection — серверные точки для тестов, не публичный API. Проверка credentials происходит при создании сервиса: ошибка в резервном credential завершает создание, даже если основной провайдер доступен.

## Выбор провайдера

Нормализованные ID: `openai`, `yandex`. Расширение списка и регистрация адаптера потребуются для будущих DeepSeek/self-hosted; сейчас неизвестные ID отклоняются.

RouterPolicy имеет id/version, maxAttempts (1 или 2), таблицу задач business/design/content/developer/qa с preferred, optional fallback и required capabilities. `readRouterPolicy` берёт общий preferred/fallback из config; сервер может задавать отдельную политику каждой задачи. Реальных новых агентов, кроме Business, нет.

Выбор детерминирован при одинаковой policy, задаче, лимите токенов и runtime health. По порядку preferred → configured fallback исключаются недоступные варианты, отсутствующие capabilities и недостаточный maxOutputTokens. Если ничего не подходит — ROUTE_UNAVAILABLE. Decision содержит provider, model, reason, fallbackProviders, policyId/version. Capability mismatch может сразу выбрать альтернативу, без попытки у неподходящего провайдера.

Capabilities: structuredOutput, toolCalling, reasoning, code, russianLanguage, vision, maxOutputTokens. Это разрешённые/настроенные возможности конкретного адаптера и модели, не рейтинг качества. Начальные flags консервативны: structuredOutput/russianLanguage включены, tools/vision/reasoning/code выключены. Включать их при будущей реализации только после проверки поддержки модели и серверных границ. Router не создаёт tools и не передаёт их автоматически.

## Контролируемый fallback

Резервный провайдер используется только если он явно настроен, подходит по capabilities/health и есть лимит попыток. По умолчанию максимум две **разные** provider attempts: первая и одна резервная. Внутри адаптеров автоматических retry нет.

| Ошибка | Fallback |
|---|---|
| TIMEOUT, NETWORK, RATE_LIMIT | Разрешён при configured fallback и доступном бюджете |
| API_ERROR с явно установленным transient для HTTP 5xx | Разрешён |
| Остальные API_ERROR, включая 4xx | Запрещён |
| AUTH, отсутствующий key/config, credential scope, ACCESS_DENIED | Запрещён |
| INVALID_REQUEST, INVALID_RESPONSE, schema/Business contract validation | Запрещён |
| REFUSAL, INCOMPLETE | Запрещён |
| CANCELLED, LIMIT_EXCEEDED, security/approval denial | Запрещён |

429 может означать лимит или баланс: адаптер не выдумывает точный billing diagnosis. Указанное правило разрешает configured fallback на 429. Ошибки 401/403 дают безопасное сообщение доступа, без body/header провайдера. Ошибка Business validation происходит после ответа Router и не запускает ещё одну генерацию.

Каждая attempt проходит authorization, RPM, concurrency, workflow request count и output-token reservation. Неудачный запрос не возвращает reservation: он мог быть оплачен. При исчерпании бюджета резервный сетевой вызов не начинается. maxRetries в существующем cost guard остаётся 0: fallback учитывается как новая bounded attempt, а не как внутренний retry адаптера. `execution.routing.attempts` сохраняет доступный usage каждой попытки; `execution.usage` — успешной/последней ошибки, а не сумма. `execution.budget` при успехе показывает накопленную reservation. Точную стоимость не рассчитываем; неизвестные токены остаются undefined.

Health — in-memory advisory tracker: transient failure даёт degraded, две подряд — unavailable на 30 секунд; успешный ответ сбрасывает состояние. После cooldown провайдер снова допускается. Auth/validation ошибки не ухудшают общий health. Tracker можно разделять внутри одного доверенного runtime; внешних health probes, Redis, фонового мониторинга и distributed circuit breaker нет. Deterministic routing не означает неизменного выбора при меняющемся health.

## Yandex adapter

Фиксированный HTTPS endpoint `https://ai.api.cloud.yandex.net/v1/chat/completions`. API key — в Authorization Api-Key; folder — OpenAI-Project; `x-data-logging-enabled: false`, stream=false и store=false. Собственное логирование prompt/response отсутствует, redirects запрещены, tools не включены.

Используется документированный `response_format: { type: json_schema, json_schema: {name, schema} }`. Непроверенная гарантия strict mode для конкретного `latest` не заявляется; strict:true не отправляется. Ответ обязательно проходит JSON.parse, Ajv и ресурсную границу, затем прежний Business validator. Неподдерживаемая моделью schema даст controlled error; автоматического отката к обычному тексту нет. Документация использует пример yandexgpt/rc, поддержка выбранного пользователем latest требует ручного нового smoke.

Настройки: YANDEX_API_KEY; KLEO_YANDEX_FOLDER_ID; KLEO_YANDEX_MODEL (суффикс `yandexgpt/latest` или полный `gpt://<folderId>/yandexgpt/latest` с тем же folder); timeout 30000 мс по умолчанию, диапазон 100–120000; max output tokens 2000 по умолчанию, диапазон 128–8000. Значения key/folder не хардкодятся.

Лимиты: сообщения 48000 UTF-8 байт; schema 32000 байт; весь request body 64000 байт; response 1 МиБ. AbortController и deadline ограничивают fetch и чтение тела, поддерживается caller cancellation. Ошибки сервера не копируются в результат. Сохраняется только безопасный x-request-id, если заголовок есть. Model в usage — проверенная конфигурация; неизвестные token counts не вычисляются вручную. Project/workflow добавляет guard, не провайдер по внешнему ответу.

Защита echo проверяет ключ как до, так и после JSON parsing — включая Unicode-escaped представление. Аналогичная проверка добавлена OpenAIProvider. Общая redaction и secret scanner расширены для схемы Api-Key. `.env` не изменялся этим этапом, значения не выводились.

Источники: [Yandex structured completions](https://aistudio.yandex.ru/en/docs/ai-studio/operations/generation/completions-structured), [Chat Completions API](https://aistudio.yandex.ru/en/docs/ai-studio/api/Chat-Completions/createChatCompletion), [отключение логирования](https://aistudio.yandex.ru/en/docs/ai-studio/operations/disable-logging). Настройки следуют официальному API; качество и поведение реальной модели не подтверждаются fake tests.

## Ручной запуск

Ключи настраиваются только локально через игнорируемый `.env` с правами 600, по `.env.example`. Не отправлять их в чат. Folder/model/router config также заполняются локально. Обычный smoke по-прежнему выбирает только OpenAI:

```sh
npm run smoke:business -- --confirm-paid-request
```

Одна задача через Yandex:

```sh
npm run smoke:business -- --provider=yandex --confirm-paid-request
```

Router использует KLEO_AI_PRIMARY_PROVIDER (по умолчанию openai) и optional KLEO_AI_FALLBACK_PROVIDER. Если fallback пуст, переключений нет. Для проверки Router с **одной** попыткой:

```sh
npm run smoke:business -- --provider=router --confirm-paid-request
```

Для явного разрешения максимум двух потенциально платных попыток той же задачи:

```sh
npm run smoke:business -- --provider=router --confirm-paid-request --allow-fallback
```

Без paid opt-in запрос не отправляется. Без allow-fallback smoke ограничен одной попыткой, независимо от общего router default. Вывод: профиль или controlled error, provider/model, project/workflow usage, route/attempts и доступная budget metadata. Все секреты применяются к redactor перед выводом. Никаких smoke paid runs автоматически из npm test.

## Проверки и дальнейшие этапы

222 offline tests, включая прежние 165: адаптер Yandex, схемы/ошибки/usage/cancellation/limits/echo, Router selection/health/fallback/no-fallback/budget и Business service integration с FakeProvider. Security checks и typecheck проходят. Новых dependencies нет.

Implemented: OpenAI/Yandex adapters, deterministic Router, guarded controlled fallback, normalized usage, local health и ручной smoke. Planned: ProviderEvaluation benchmark runner/quality scores, другие провайдеры, self-hosted, динамическая маршрутизация и production shared state. ProviderEvaluation сейчас только тип; score не присваивается автоматически.

Следующий шаг — отдельный явный запуск нового Yandex Business smoke на учебных данных. Затем Design Agent можно реализовывать через тот же service/router/guard и validation boundary. Это не свидетельство production-готовности всего Kleo.
