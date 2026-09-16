# Real Developer Agent

Статус: **IMPLEMENTED**, проверен offline. Реальные OpenAI/Yandex Developer smoke ещё не выполнялись. Исходная точка — e0f06fc и 576 тестов. Владелец подтвердил OpenAI Content live PASS и корректный grounding rejection Yandex Content. Эти результаты не доказывают работу Developer с реальной моделью.

## Роль и архитектура

Canonical `packages/website-model` остаётся source of truth. Сохранены публичные Website, WebsitePage, WebsiteBlock, DesignSystem и DeveloperOutput. HTML/React/CMS JSON не являются выходом Developer. Renderer, preview, adapters и publisher — будущие отдельные слои.

Путь: validated Business + Design + grounded Content → DefaultDeveloperAgent → AIRouter → GuardedAIProvider → OpenAI/Yandex → strict layout proposal → resource/schema/order validation → server Website builder → strict Website runtime validation + exact copy reuse → workflow state → текущий переданный QA. Новый real QA не реализован.

Агент получает только Router. Создание Router и разрешение credentials принадлежат createRoutedDeveloperService/createGuardedRouter. У агента нет SecretProvider, env, fs, shell, tools, произвольной сети или доступа к публикации. Builder — локальный доверенный код, без исполнения данных модели. Изоляция процесса и production API/storage enforcement по-прежнему требуют будущей инфраструктуры.

## Контракты

```ts
interface DeveloperAgentInput {
  business: BusinessProfile;
  design: DesignDirection;
  content: ContentPlan;
  businessFacts?: string[];
}
interface DeveloperLayoutProposal {
  sections: { sectionIndex: number; alignment: 'left' | 'center' }[];
}
interface DeveloperOutput {
  website: Website;
  generatedAt: string;
  notes?: string;
}
```

Контекст — существующий AgentContext с projectId/goal и optional AbortSignal. projectId должен соответствовать серверному контексту guard; идентификаторы организации, actor, workflow и credentials не берутся из model output. Нет дополнительных model-owned ownership/status полей.

Input проходит plain JSON/resource validation до чтения содержимого, затем существующие Business/Design/Content validators и Content grounding. Optional businessFacts имеет те же ограничения, что у Content: 1–20 безопасных непустых строк до 500 символов. В обычном workflow explicit facts должны быть отражены в BusinessProfile; произвольный task input не прокидывается как новая factual authority. Design не подтверждает коммерческие утверждения. Вход отделяется snapshot до ожидания ответа.

Верхний ресурсный предел входа: 52000 байт, строка до 8000, массив до 50, глубина 6, 1000 узлов; вложенные валидаторы задают меньшие лимиты. User DATA дополнительно ограничен 18000 символами для совместимости с существующими adapters. Oversized input отклоняется до запроса. Все business/design/content/goal данные остаются недоверенными DATA; инструкции внутри них не исполняются.

LLM предлагает только alignment для каждой существующей секции. Индексы 0…N−1, N — 1…10; все секции ровно один раз, в исходном порядке. Размер массива строго N, unknown properties запрещены, включая copy, IDs, status, components, styles, SEO, URLs. Proposal ограничен 4000 байтами, строкой 100, глубиной 3 и 50 узлами. Optional/null полей нет, поэтому wire/domain рассинхронизации optional значений здесь нет. Код не исправляет повреждённый ответ в success.

## Серверная сборка Website

- Website ID: server `crypto.randomUUID()`. Page ID: `<website-id>-page-0`; block ID: `<page-id>-block-<index>`. IDs не приходят от модели, уникальны внутри результата и привязаны к конкретному Website. Они не заменяют authorization.
- projectId — проверенный контекст вызова, совпадающий с guard. Status Website/Page всегда `draft`; createdAt/updatedAt/generatedAt — одна серверная ISO timestamp.
- Ровно одна page, slug `/`, order 0. Это существующая home-page convention. Дополнительные страницы модель создать не может.
- Website.name и page.title — ContentPlan.pageTitle. Каждый block сохраняет исходный section order, visible=true.
- Copy: только существующие heading/text/points/callToAction соответствующей секции, без переписывания или новых labels. points копируется в отдельный массив. purpose, toneOfVoice, notes и keyMessages не превращаются в дополнительные опубликованные тексты.
- SEO title — pageTitle; optional description — неизменённый text первой секции, если он присутствует. Keywords не генерируются. Это минимальные SEO поля, не SEO/GEO оптимизация.

| Content section | Website block |
|---|---|
| hero, text, services, advantages, faq, cta | Тот же тип |
| process | text |
| custom, gallery, testimonials, contacts | text: только проверенное plain copy |

Неизвестный Content type отклоняется input validator. На этой границе не создаются image/custom/gallery/testimonials/contacts blocks: нет утверждённых media, executable custom, отзывов или контактных контрактов. Не выдумываются URLs, телефоны, адреса, часы работы и изображения. Последующее введение этих block contracts требует отдельной schema и review.

## Design mapping и defaults

Colors копируются из DesignDirection и повторно проверяются существующей HEX schema (#RGB/#RRGGBB). Типографические описания переводятся в allowlisted локальные токены: Sans/«без засечек» → Arial; Serif/«с засечками» → Georgia; прочее → Arial. Приоритет sans исключает ошибочное распознавание «sans serif» как serif. Внешние font URLs, CSS functions и произвольные font values не допускаются.

Deterministic defaults: baseFontSize 16, section spacing 64, block spacing 24, borderRadius 8. Runtime bounds: font size 12–32, section spacing 0–200, block spacing 0–100, radius 0–48. Shadows/кнопочные CSS expressions не добавлялись. Единственная разрешённая настройка блока — alignment left/center. Она становится формализованным подмножеством прежнего generic settings, без изменения публичного WebsiteBlock type. Будущий renderer должен явно интерпретировать эти токены.

## Повторная runtime boundary и grounding

`validateWebsiteAgentOutput('developer', ...)` теперь вызывает строгий Developer Website validator. TypeScript не заменяет эту проверку. Общий Website Model остаётся шире безопасного текущего Developer subset; runtime не разрешает всё, что способен выразить generic Record.

Проверяются plain JSON, unknown fields, безопасные copy strings, HEX/fonts/dimensions, даты, project ownership, draft status, IDs, slug, orders, разрешённые block types, bounded content/settings/SEO. Общие пределы: 64000 байт, строка 2000, массив 10, глубина 8, 1000 узлов. Context-free schema допускает до 10 страниц для существующей модели, однако Developer/reuse path требует одну home page. IDs всех уровней не дублируются; page slug/order и block order уникальны. Slug/ID не допускают traversal, URL, query, control characters и trailing newline.

После Website validation выполняется copy reuse: ни один существующий текст Website/SEO/block не может отличаться от разрешённого upstream поля. Нельзя взять утверждение из Design или добавить «Гарантия 5 лет» в heading. Новая реализация копирует все секции/поля. Для совместимости с прежними явно переданными серверными draft builders reuse разрешает подмножество исходных полей и префикс секций; новые строки всё равно запрещены. Такие реализации являются trusted server injection, не пользовательским параметром.

Content grounding повторно проверяется до генерации. Его ограничения RU/EN heuristics сохраняются: Developer предотвращает новый канал выдумывания copy, но не доказывает истинность самого BusinessProfile/ContentPlan и не исправляет незамеченные upstream ошибки. Существующая security validation не ослаблена. HTML/script/shell/URL/credentials отклоняются; принятый текст не исполняется.

## Routing, scopes, расходы и отмена

Developer использует существующий createGuardedRouter с taskType=developer. Actor/project/organization membership, scoped credential refs и SecretProvider проверяются сервером. Request другого project отклоняется guard. Полномочия/keys/model/provider selection не передаются модели. Никакой новой routing/fallback реализации нет.

Общий AICostGuard должен быть разделён между всеми стадиями и attempts. Сохраняются provider/model/requestId/projectId/workflowId/actorId/organizationId/agentType=developer, доступные input/output/total/cached tokens, duration/timestamp, routing и budget. При malformed proposal usage сохраняется, attempt может оставаться success. Если provider не вернул usage — значение остаётся неизвестным, не нулевым. Отдельного cost/quota engine нет.

Transient provider errors допускают прежний bounded fallback. Validation/security/auth/scope/budget/cancellation ошибки не запускают repair LLM или дополнительный provider. AbortSignal проходит к Router/provider; после await агент ещё раз проверяет отмену до builder и перед success. Workflow передаёт signal стадиям и проверяет отмену между стадиями. У прежнего Business Agent внутривызовная отмена не расширялась: workflow остановится после его возврата; Developer поддерживает отмену транспорта.

## Workflow, ошибки и diagnostics

createWebsiteWorkflowService по умолчанию создаёт real Design, Content и Developer; Business и текущий QA передаются сервером. Явные trusted Content/Developer implementations сохранены для совместимости. Последовательность: Business → Design → Content → Developer → current QA.

Developer failure/exception/malformed/cancellation не записывает state.developer и не вызывает QA, сохраняя business/design/content и доступную execution telemetry. Успех передаёт validated Website текущему QA. Ошибка более позднего QA не отменяет уже созданный draft. Данные для Developer отделены snapshot, поэтому изменение его input не меняет прежнее состояние/эталон copy.

Произвольные сообщения Developer не раскрываются: failed result → `developer: Developer failed`; exception → `developer: Developer execution failed`. Это намеренное усиление security boundary. Два старых универсальных ожидания `developer: Unavailable` обновлены; новые regression tests проверяют скрытие приватного error text и сохранение предыдущего state/безопасной диагностики. Другие стадии не подвергались рефакторингу обработки ошибок.

Developer validationError содержит allowlisted stage/path/rule без значений и совпадений. Стадии: developer-input/json/schema/semantic/website/grounding. Коды: INVALID_INPUT, INVALID_JSON, RESOURCE_LIMIT_OR_NON_JSON, SCHEMA_INVALID, SECTION_ORDER, COPY_MISMATCH, WEBSITE_INVALID, PROVIDER_OUTPUT_INVALID. Proposal с новым copy отклоняется schema, поэтому отдельная NLP-классификация его выдуманного обещания не требуется. Workflow сохраняет только проверенный Developer diagnostic, runtime ошибки также получают безопасный diagnostic. При provider отказе локальная причина может быть неизвестна — PROVIDER_OUTPUT_INVALID не выдаётся за точный upstream диагноз.

## Ручной smoke

```sh
npm run smoke:developer -- --provider=openai --confirm-paid-request
npm run smoke:developer -- --provider=yandex --confirm-paid-request
```

До opt-in и проверки flags конфигурация/сеть не используются. Учебные Business/Design/Content заданы локально; дополнительные генерации этих агентов не запускаются. Один потенциально платный Developer request, maxAttempts=1, concurrency=1, output ceiling 2000 (меньший config limit сохраняется). Ни один из этих live smoke в задаче не выполнялся.

Вывод — безопасный summary: website name/status, pages slug/title/blockTypes/blockCount и allowlisted usage/routing/budget/requestId/scopes. Полный Website/copy/prompt/headers/credentials/raw proposal не печатаются. Повторные usage ссылки копируются отдельно, исключая CIRCULAR. На failed validation никакие Website values не выводятся. Реальные adapters проверены fake transport, включая schema, credential echo, oversized body, timeout и network failure.

## Проверки, ограничения и следующий шаг

Наборы: developer-contract, routed-developer, developer-workflow, developer-smoke; fixtures/developer. Прежний workflow suite обновлён под безопасные ошибки. Общий набор — 730 тестов. Новых npm dependencies нет; env и ключи не менялись, commit не делался.

Это начальный структурный Developer: LLM выбирает только alignment, а не полноценную визуальную композицию. Не реализованы multi-page planning, media/assets, контактные формы, renderer/preview, CMS/publishing или визуальные/accessibility проверки. `draft` означает объект в памяти, не сохранённый и не опубликованный сайт.

Следующий шаг — ручные OpenAI/Yandex Developer smoke и review модели Website; затем отдельное ТЗ на Real QA. Real QA, database, frontend, renderer, publishing, CMS, Admin Console, production billing, Sentinel, public pentest и AI Red Team остаются PLANNED. Security Gate, обязательный pentest, исправление Critical/High и Retest PASS сохраняются обязательными условиями публичного запуска.
