# Client Token Quotas, Cost Accounting и Admin Console

Статус: **PLANNED**, кроме перечисленной основы telemetry. Биллинга, базы расходов, тарифного движка и интерфейсов в коде нет.

## Доступная основа

AIUsageRecord совместимо расширен optional actorId, organizationId, agentType, cachedInputTokens. Guard устанавливает actor/project/org/workflow/type из доверенного server context, перекрывая одноимённые данные провайдера. Actor — пользователь, выполняющий действие; будущий billing customer/account может отличаться и должен связываться сервером, не моделью.

Сохраняются provider/model, inputTokens/outputTokens/totalTokens, durationMs, timestamp начала запроса, безопасный requestId, cachedInputTokens при наличии в ответе. OpenAI читает input_tokens_details.cached_tokens, Yandex — prompt_tokens_details.cached_tokens, если поле действительно пришло. Наличие поля у конкретной модели Yandex не обещается. Некорректные/неизвестные counts остаются undefined, не 0. Cached input — подмножество input, его нельзя прибавлять к total.

routing.attempts хранит порядок попыток, provider/model, outcome/errorCode и отдельные usage snapshots. Первая фактически выполненная попытка имеет индекс 0, последующая — fallback. Decision сохраняет причину выбора и версию policy. Не считать top-level usage дополнительной попыткой: это последняя доступная запись, а не сумма. Reservations — верхний технический бюджет, не фактические токены или денежная стоимость. Ошибка до ответа может иметь только provider/model/timing; запрос мог быть оплачен. Preflight denial не означает выполненный AI-запрос.

WebsiteWorkflowResult.executions сохраняет execution по этапам, включая возвращённую агентом ошибку и malformed output. WebsiteWorkflowState сохраняет прежние business/design/... контракты. Telemetry существует в памяти результата; durable storage, event sink, deduplication и reconciliation не реализованы. При необработанном exception агент может не вернуть execution; остановка и ранее накопленная telemetry сохраняются.

Будущий collector должен сохранять только allowlist telemetry, не весь execution с goal. Нельзя сохранять prompts, raw responses, headers, credentials или model data в финансовые журналы. Корреляция не отправляется провайдеру в prompt. Для долговременного учёта нужны серверный уникальный invocation/attempt ID, идемпотентность и lifecycle workflow; provider requestId может отсутствовать. Текущая готовность — совместимые данные для этого этапа, не готовый финансовый ledger.

## Client Token Quotas — PLANNED

Месячные token/AI-credit лимиты клиента по тарифу; разрезы customer/project/workflow/agent/provider/model; предупреждения 70% и 90%; порог 100%; controlled denial и переход на другой тариф; дополнительные AI-credit packages. Manual credits и quota overrides требуют прав и аудита. Нужны атомарные reservation/settlement, правила ошибок/fallback/cached usage, периоды и дедупликация.

Текущий Design smoke: максимум 1 запрос, 1 concurrent request и не более 2000 выходных токенов (меньшее значение config сохраняется). Это техническая защита конкретного запуска, **не тарифная или месячная квота**. Общий AICostGuard остаётся единственным реализованным cost-control механизмом; отдельный quota engine не создавался.

## Cost Accounting и profitability — PLANNED

AI API cost по клиенту, проекту, workflow, агенту, provider/model и периоду. В будущем — версионированные provider prices, валюта, cached pricing и сверка с фактическими расходами. Сейчас pricing tables, цены, cost DB, payment integration, invoices и subscriptions не реализованы.

Gross profit = Revenue − AI API cost − server/infra cost allocation − other variable cost.

Gross margin % = Gross profit / Revenue × 100; при Revenue = 0 показатель не определён, а не 0%. Правила распределения инфраструктурных расходов и периоды требуют отдельного согласования.

## Admin Console владельца — PLANNED

Отдельный модуль, отделённый от клиентского кабинета. Доступ только административным ролям Kleo; роль owner клиентского проекта сама по себе не даёт глобального доступа. Нужны MFA, least privilege и аудит финансовых/квотных изменений.

| Раздел | Будущие данные |
|---|---|
| Customers | Пользователи, клиенты, проекты, активность, тарифы, статусы подписок |
| Subscriptions | Active/cancelled/trial, upgrades/downgrades, MRR, ARPU |
| AI usage | Input/output/total/cached tokens по агенту, provider/model, проекту и клиенту |
| AI cost | OpenAI, Yandex, будущие providers, cost per workflow/customer |
| Margin | Revenue, AI cost, infrastructure allocation, variable cost, gross profit и margin |
| Quotas | AI credits, token limits, balance, warnings, manual credits, overrides |
| Providers | Health, latency, errors, rate limits, fallback frequency |
| Security | Audit log, suspicious actions, rate-limit/credential events, incidents |
| Infrastructure | Server usage, storage, traffic, errors, будущие queues |

UI, агрегаты, cost database, provider balance synchronization и административные API не создавались.

## Client UI — PLANNED

Понятные AI Credits / usage %, например использовано 68%, осталось 32%. Клиенту не обязательно видеть внутренние цены токенов OpenAI/Yandex. Внутренняя Admin Console должна показывать реальные расходы. Клиентский usage UI пока не реализован.
