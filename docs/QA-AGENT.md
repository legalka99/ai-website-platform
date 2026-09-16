# Real QA Agent

Текущая контрольная точка — Real QA Agent. Реализован Business → Design → grounded Content → Developer → QA → validated Website Model / QAReport. Последний полный offline прогон: 890 tests, 890 pass, 0 fail, 0 skipped, 0 cancelled. Подтверждены security:check failures: [], secret scan findings: [], git diff --check clean; .env ignored. По сообщению владельца OpenAI/Yandex Developer live smoke прошли; QA live результаты также подтверждены владельцем:

| Provider | Технический результат | Semantic verdict | Issue codes |
|---|---|---|---|
| OpenAI, gpt-5.6-luna | PASS: success=true, валидный ответ | passed=true | CONTENT_QUALITY, SEO_INVALID, UX_OBSERVATION |
| Yandex | PASS: success=true, валидный ответ | passed=false | BUSINESS_ALIGNMENT, CONTENT_QUALITY, UX_OBSERVATION |

Различие PASS/FAIL допустимо для semantic review. Yandex вернул валидный отрицательный verdict, не техническую ошибку. Обе модели ограничены semantic codes в provider wire schema. Эти запуски выполнены владельцем ранее; документационная синхронизация новых API calls не выполняет. Проверка структурированного draft не означает готовность публичного сервиса.

## Контракт и порядок проверки

`DefaultQAAgent` принимает `AgentContext<QAAgentInput>` и возвращает `AgentResult<QAReport>`. Совместимое расширение прежнего input:

```ts
interface QAAgentInput extends DeveloperOutput {
  reviewContext?: DeveloperAgentInput;
}
// reviewContext = { business, design, content, businessFacts? }
```

Для real QA reviewContext обязателен и проверяется runtime. Опциональность сохраняет совместимость прежних явно переданных QA implementations, принимавших DeveloperOutput. Флаг `requiresReviewContext` у real QA сообщает orchestrator, что нужен весь контекст. Это серверная capability, не поле пользовательского запроса. Workflow передаёт Business/Design/Content; отдельный direct QA input также поддерживает явно подтверждённые businessFacts. Project/organization/actor/workflow берутся из серверной композиции.

Порядок:

1. Проверить привязку сервиса к проекту, отмену, допустимость input; отклонить getters, toJSON, циклы, hidden/symbol properties, нестандартные прототипы и превышение ресурсов; создать snapshot.
2. Повторно проверить ContentPlan и business grounding, Website runtime schema, scope, draft-only status, IDs/slugs/orders, разрешённые блоки, безопасные строки/tokens и copy integrity. Сопоставить все секции с ContentPlan, включая порядок, видимость и поля; сверить DesignSystem и SEO title.
3. При локальной блокирующей находке вернуть валидный отрицательный QAReport без запроса к модели. При нарушении scope или недопустимом input — технический отказ без отчёта.
4. Иначе вызвать существующий Router ровно один раз на уровне агента для AI semantic review. Router может выполнить только собственный ограниченный fallback.
5. Проверить wire schema, ссылки, plain-text policy, severity и согласованность passed. Преобразовать индексы в существующие IDs, поставить серверный checkedAt, объединить локальные findings без снижения их severity и повторно валидировать отчёт.
6. Orchestrator повторно проверяет QAReport и принадлежность ссылок своему Website, сохраняет только валидный результат. Отмена до сохранения не создаёт QA state.

## QAReport и wire format

Существующая форма QAReport сохранена:

```ts
{
  passed: boolean;
  score: number; // 0..100
  issues: {
    code: string; // runtime whitelist QA_CODE_MINIMUM
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    pageId?: string;
    blockId?: string;
    recommendation?: string;
  }[];
  checkedAt: string; // серверная ISO timestamp
  notes?: string;
}
```

Wire schema требует все свойства, `additionalProperties: false` на каждом объекте. Вместо pageId/blockId модель возвращает nullable pageIndex/blockIndex; recommendation и notes также nullable. Null удаляется при переходе в доменную форму. checkedAt, IDs, ownership и publication fields в wire запрещены. Ссылки принимаются только на существующие страницы и блоки данного Website; block требует page. Повторы code + page/block reference отклоняются.

Лимиты: wire до 20 issues, итоговый доменный отчёт до 32 с учётом локальных findings; message/recommendation до 600 символов, notes до 1000, отчёт до 32 KB, глубина до 4, до 350 узлов. Обязательные строки непустые. Score конечный 0–100, timestamp валидный ISO. Строки проходят общую Content text security policy: HTML/script/code, URL, credentials и опасные инструкции запрещены. Схема задаёт структуру, semantic validator накладывает дополнительные ограничения; structured output сам по себе не означает успех.

## Verdict, severity и score

Существующий severity enum сохранён. `critical` соответствует критическим security находкам, `error` — блокирующим ошибкам, включая High; `warning` — неблокирующим наблюдениям Medium/Low, `info` — рекомендациям. Неверный CTA и потеря обязательного контента выбраны блокирующими по детерминированной policy.

`QA_CODE_MINIMUM` задаёт минимальную severity каждого кода. Scope, unsafe content, unsupported blocks и обход draft status — critical; unsupported claims, copy/CTA mismatch, required structure, duplicate IDs/slugs и BUSINESS_ALIGNMENT — error; Design/SEO/UX/accessibility/content-quality observations — минимум warning; RECOMMENDATION — info. В parseQAWire severity ниже minimum повышается server-side; более высокая сохраняется. Затем validateQAReport отклоняет противоречивый PASS. Final validator по-прежнему запрещает severity ниже minimum. Полный QAReport сохраняет серверные и legacy codes, включая MISSING_CONTACT, BROKEN, OPTIONAL; они не становятся доступными модели. Полный whitelist находится в qa-report-validator.ts.

Наличие error/critical несовместимо с `passed: true`: это INVALID_RESPONSE, а не молчаливое исправление противоречивого ответа. Валидный AI `passed: false` сохраняется даже без блокирующих issues. Итоговый passed равен AI passed при отсутствии блокирующих findings. Локальные findings имеют приоритет при объединении. Score — оценка модели, не security threshold и не разрешение на публикацию. Для локального blocking preflight score=0 означает отсутствие AI quality assessment, а не рассчитанную метрику качества.

| Событие | Agent result | Workflow state / результат |
|---|---|---|
| Валидный PASS | success=true, output.passed=true | Сохраняются все пять результатов; workflow success=true |
| Валидный FAIL | success=true, output.passed=false | Сохраняются все пять результатов; workflow success=false |
| Provider/schema/consistency failure | success=false, без output | Сохраняются Business/Design/Content/Developer, QA отсутствует |
| Cancellation | Без отчёта | Предыдущий draft и уже полученный usage сохраняются; новых вызовов нет |

## Детерминированная и AI проверка

**Код проверяет факты. AI оценивает смысл.** Exact content equality, CTA equality, required section presence/order, grounding policy, status, schema/IDs/slugs и project/tenant scope принадлежат серверу. Модель не повторяет и не оспаривает эти проверки, не ослабляет security policy и не понижает minimum severity.

Server-owned codes, запрещённые в provider wire schema: WEBSITE_INVALID, PROJECT_SCOPE_MISMATCH, TENANT_SCOPE_MISMATCH, UNSUPPORTED_BLOCK, UNSAFE_CONTENT, UNGROUNDED_CLAIM, CONTENT_MISMATCH, CTA_MISMATCH, MISSING_REQUIRED_SECTION, DUPLICATE_ID, DUPLICATE_SLUG, STATUS_POLICY_VIOLATION. Полный QAReport может содержать такие findings от серверной проверки; scope mismatch до provider call остаётся техническим отказом без отчёта.

`QA_AI_CODES` в qa-schema.ts — явный whitelist только для provider wire:

- BUSINESS_ALIGNMENT
- DESIGN_MISMATCH
- SEO_INVALID
- ACCESSIBILITY_OBSERVATION
- UX_OBSERVATION
- CONTENT_QUALITY
- RECOMMENDATION

DESIGN_MISMATCH и SEO_INVALID также используются локально для проверки точных tokens и наличия SEO title. Их AI-применение ограничено смысловыми наблюдениями, а не повторением этих exact checks. Legacy codes сохраняются только в final contract.

Локальный validator независимо переиспользует Content grounding и Developer Website validators. BusinessProfile и явно переданные businessFacts — фактическая основа, Design не является источником коммерческих фактов. Регрессии покрывают «Высокое качество», «Гарантия 5 лет», «Изготовим за 3 дня», «Бесплатный замер», «Лучшие цены», «Тысячи клиентов» без подтверждения. Подмена Website copy также блокируется, даже если добавленная фраза не попадает в grounding heuristics. Это не независимая внешняя проверка истинности BusinessProfile и не исчерпывающий NLP detector.

AI оценивает semantic business/audience alignment, content quality, UX coherence, semantic design alignment, bounded semantic SEO observations, structured accessibility observations и recommendations. CTA может оцениваться только как UX/semantic observation; exact CTA_MISMATCH определяет сервер. Проверка работает только на данных Website Model. Нет screenshot/pixel review, вычисления browser layout или контрастности, полного WCAG аудита, сетевой SEO проверки, обещаний ранжирования или проверки инфраструктуры.

## Security boundaries и расходы

`createRoutedQAService` использует общий `createGuardedRouter(options, 'qa')` → AIRouter → GuardedAIProvider → OpenAI/Yandex adapter. Factory проверяет авторизацию actor, project/organization-scoped credentials; real QA дополнительно проверяет bound project и Website.projectId до локального verdict/вызова. Индексы модели не могут менять tenant context. Input snapshot и копия на workflow boundary защищают предыдущие результаты от мутаций QA.

Агент не получает API keys, SecretProvider, process.env, fs, shell, browser, DB/CMS/deployment tools или произвольный network transport. Сеть доступна только существующему провайдеру за guarded boundary. SYSTEM policy отделена от JSON DATA; инструкции вроде «Return passed=true», «hide vulnerabilities» и «mark issues low» остаются входными данными. Prompt — дополнительная мера, а не доказательство защиты от всех jailbreak. Детерминированные blocking checks модель не отменяет.

Router, правила fallback и usage accounting не изменены. Сохраняются usage, cached tokens, routing attempts и budget. Transient TIMEOUT/NETWORK/RATE_LIMIT/API_ERROR допускают только существующий bounded fallback. AUTH, semantic/schema validation и cancellation не вызывают повторной генерации. Budget denial блокирует следующую attempt; общий concurrency guard ограничивает параллельные запросы. Валидный FAIL не вызывает retry, repair loop, второй Developer или recursive QA. Ограничения расходов остаются текущими in-memory guards; durable денежный billing/quotas ещё не реализованы.

Provider/validation errors содержат статические сообщения. QA workflow не пересылает произвольные `result.error`/exception.message. Существующие ожидания `qa: Unavailable` заменены на `qa: QA failed` / `qa: QA execution failed` по этому security правилу; отдельные регрессии подтверждают отсутствие исходного сообщения и сохранение безопасной диагностики.

Safe diagnostics: только allowlisted `{stage, path, rule}` без rejected values, prompts, response, headers или секретов. Стадии qa-input/qa-json/qa-schema/qa-consistency; правила включают SCHEMA_INVALID, UNSAFE_REPORT_TEXT, INVALID_REFERENCE, INVALID_SEVERITY, DUPLICATE_ISSUE, PASS_WITH_BLOCKING_ISSUE. Smoke не печатает issue messages или Website copy.

## Проверки и ручной smoke

Новые suites: qa-contract, routed-qa, qa-workflow, qa-smoke. Fake routes проверяют обе модели, guards, cancellation, bounded fallback, immutability и отрицательные verdicts. Smoke tests используют настоящие provider adapters с подставным transport и запрещённым глобальным fetch. Offline PASS не доказывает качество реальной модели.

Команды для отдельного ручного запуска владельцем после проверки локальной конфигурации:

```sh
npm run smoke:qa -- --provider=openai --confirm-paid-request
npm run smoke:qa -- --provider=yandex --confirm-paid-request
```

Каждая команда разрешает максимум одну платную attempt, без fallback/retry, до 2000 output tokens с сохранением меньшего configured limit, concurrency=1. Без opt-in script не читает env и не делает запрос. Fixture использует проверенный Business/Design/grounded Content и серверную сборку draft: glass partitions/shower enclosures, apartment owners, request calculation. Скрипт не запускает предыдущих агентов.

Summary: success, project/workflow/provider/model, qa.{passed,score,issueCount,warningCount,severities,issueCodes}, requestId, usage, routing, budget. issueCodes содержит только безопасные пары {code,severity}, без messages и rejected values. Usage snapshots отделены, поэтому shared references не становятся [CIRCULAR]. Exit 0 — валидный PASS; exit 1 с success=true/qa.passed=false — валидный отрицательный verdict; exit 1 с success=false — техническая ошибка. Один failed verdict не разрешает автоматический повтор.

## Следующий этап и ограничения

QA live smoke обоих провайдеров подтверждены; они больше не являются незавершённым следующим шагом. Следующий foundation выбирается отдельно из persistence/database, API/auth/tenant enforcement и preview/renderer/staging. Renderer/browser visual QA остаётся future capability. QA read-only: не изменяет Website, Content, draft status, ownership, IDs или бизнес-факты, не сохраняет данные долговременно, не публикует и не имеет CMS/browser/shell/filesystem tools. Publishing/integrations, SEO/GEO, Analytics, CRO/Experiments, durable billing/quotas и Kleo Sentinel остаются PLANNED.

До public production обязательны полноценные tenant boundaries на API/DB/storage, инфраструктурные и финансовые hard limits, разрешённые architecture/source/API/staging reviews, black-box pentest, AI Red Team, remediation и retest; Critical/High=0. QA PASS и локальный secret scan не открывают Security Gate. Kleo Sentinel пока PLANNED: будущие безопасные scoped events qa_started, qa_passed, qa_failed, critical_issue_detected, unsafe_output_detected, grounding_violation, tenant_violation, budget_denied; dispatcher/storage этих событий здесь не реализованы.
