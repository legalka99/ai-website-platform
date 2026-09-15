# Design Agent: контракт и валидация

Implemented: DefaultDesignAgent и createRoutedDesignService подключены к AIRouter через общую серверную фабрику createGuardedRouter. Вход проверяется до запроса; ответ проходит существующую доменную validation. Workflow integration и ручной smoke:design реализованы. Реальные Design smoke остаются ручным следующим шагом.

## Достаточность DesignDirection

Существующие поля достаточны для первого описательного Design Agent: styleName, description, mood, colors, typography, layoutPrinciples, optional visualReferences/notes. Поля и их optional-статус не менялись. WebsiteWorkflowState.design по-прежнему имеет тип DesignDirection; текущие Business → Design → Content/Developer связи совместимы.

DesignDirection не заменяет Website Model DesignSystem. Он описывает направление и стили заголовков/основного текста; конкретные headingFont/bodyFont/baseFontSize/spacing/borderRadius принадлежат DesignSystem и будущему этапу реализации. Добавлять в DesignDirection HTML, CSS, контент, страницы или параметры исполнения не требуется.

## Вход

`AgentContext<DesignAgentInput>`: projectId и goal остаются в контексте, `input` — плоское расширение BusinessProfile. Поэтому прежний BusinessProfile без дополнительных полей остаётся допустимым входом существующего workflow.

Новые optional-поля:

- designPreferences: style?, mood?, colors? (частичная палитра Website Model), notes?.
- existingDesignSystem?: существующий DesignSystem из Website Model, чтобы следующий агент мог учитывать оформление проекта.

Вход проверяется строгой runtime schema: неизвестные поля, getters, hidden/symbol properties и превышение лимитов отклоняются. До 16000 UTF-8 байт, глубина 4, 500 узлов, до 50 элементов бизнес-массивов; description до 8000 символов, остальные строки до 2000 или меньше. Палитры — HEX; размеры DesignSystem ограничены. Goal до 2000 символов, projectId до 200. Credential-looking данные блокируются общей DATA policy.

BusinessProfile, preferences, existingDesignSystem и goal передаются только в пользовательском DATA-сообщении. Metadata не передаётся. Системный prompt запрещает выполнять вложенные инструкции, выдумывать факты и генерировать HTML/CSS/code/контент/страницы. Optional signal в DesignAgentContext передаётся Router для отмены, без сериализации в prompt. Загрузка DesignSystem из хранилища и проверка его принадлежности проекту остаются обязанностью будущего серверного workflow: сам объект DesignSystem не содержит projectId.

## Выход и лимиты

`AgentResult<DesignDirection>`; успешный output агента обязательно проходит `validateDesignDirection`. Существующая workflow boundary использует тот же validator, и реальный агент подключён через createWebsiteWorkflowService.

| Поле | Ограничение |
|---|---|
| styleName | Непустой текст, до 100 символов |
| description | Непустой текст, до 2000 символов |
| mood | 1–8 непустых строк, до 80 символов каждая |
| colors.primary/background/text | Обязательные HEX #RGB или #RRGGBB |
| colors.secondary/accent | Optional, тот же HEX формат; null/пустые строки недопустимы |
| typography.headingStyle/bodyStyle | Обязательный текст, до 300 символов |
| layoutPrinciples | 1–12 непустых строк, до 300 символов каждая |
| visualReferences | Optional, 0–8 текстовых описаний мотивов, до 300 символов; не ссылки |
| notes | Optional, непустой текст до 1000 символов |

Неизвестные поля запрещены на всех уровнях. RGB-функции, имена цветов, CSS variables, alpha HEX и URL цветов не принимаются: выбран узкий однозначный формат. Optional-поля можно опустить, но нельзя передать null или undefined в JSON-объекте. Общие пределы: 24000 UTF-8 байт, 12 элементов массива, глубина 4 и 150 узлов; дополнительно действуют меньшие лимиты конкретных полей.

Schema проверяет структуру, типы, длины, массивы и HEX. Runtime добавляет узкий допустимый набор символов описательного текста и блокировку разметки, code fences, CSS/JS/shell/SQL-подобных конструкций, URL/domain/IP, email, encoded delimiters и credential-looking строк. visualReferences — только текст, например «матовые поверхности и мягкий боковой свет». Управляющие и невидимые символы, accessors, циклы и не-JSON данные отклоняются до проверки схемы. Ошибки содержат безопасный путь и фиксированное сообщение, без исходного значения или неизвестного имени поля.

Выход не очищается и не исправляется молча: нарушение даёт valid=false; workflow не передаёт такой design дальше и сохраняет уже проверенный business. Нет исполнения текста или загрузки референсов.

## Границы безопасности и следующий этап

Прошлый design validator принимал любые непустые строки цветов, не ограничивал размеры и игнорировал unknown fields. Эти пробелы закрыты для DesignDirection. Валидация Website Model других этапов не переписывалась.

Детектор кода/секретов консервативен, допускает ложные отказы и не доказывает отсутствие произвольного неизвестного секрета в обычной прозе. Принятый текст нельзя исполнять или трактовать как HTML/URL. Качество дизайна, contrast/accessibility и сохранение существующей дизайн-системы ещё требуют семантической проверки, а не одной схемы.

Доменная schema и DesignDirection не изменены. Provider wire schema требует все поля; optional notes/visualReferences/secondary/accent допускают null. Нормализация удаляет только эти null, затем обязательно выполняется прежняя строгая доменная проверка. Неизвестные поля не удаляются. Повреждённый JSON или небезопасный результат возвращается как INVALID_RESPONSE без output и без дополнительной попытки.

Серверная фабрика проверяет actor/project/org, разрешает scoped credentials и собирает Router с taskType design. Общий GuardedAIProvider и AICostGuard используются для всех попыток. Агент получает только Router, не secrets/provider adapters. Правила fallback не изменены. Usage, routing и доступный budget сохраняются также при невалидном ответе; ошибки безопасные. Физическая изоляция процесса и качество ответов требуют отдельных проверок.

Проверка: 351 offline тест, включая прежние 327. Новых зависимостей нет. Реальные API не вызывались, `.env` не изменялся, коммит не создавался. Следующий этап — ручной Design smoke, затем Content Agent.

## Готовность к ручному Design smoke

`npm run smoke:design -- --provider=openai --confirm-paid-request` и вариант `--provider=yandex`. Без paid opt-in или с invalid args конфигурация/сеть не используются. Учебный профиль и нейтральные preferences заданы в скрипте. Один запрос, max concurrent 1, output ceiling 2000 (меньший config limit сохраняется), fallback отключён только в smoke policy. В обычном сервисе прежний controlled fallback сохраняется.

Wire schema — независимый JSON snapshot без повторных ссылок под-схем; иначе resource validator реального адаптера отклонял запрос. Оба настоящих адаптера проверены подставным транспортом, без сети. Поля DesignDirection не расширялись: styleName/mood/palette/typography/layoutPrinciples достаточно для описательного входа Content/Developer; они не являются готовым CSS или полной Website Model DesignSystem.

Business grounding: prompt запрещает неподтверждённые утверждения о лидерстве, стаже, сертификации, экологичности, географии и premium/luxury бизнес-позиционировании. Визуальная интерпретация допустима. Explicit visual preferences имеют приоритет над свободной генерацией, существующая система служит базой. Это инструкция модели, не полноценный fact-checker или гарантия семантической точности. `colors to avoid` можно описать в существующем notes; нового поля/merge engine не добавлено. DATA-инъекции проверены: policy не меняется, credential-looking данные могут быть отклонены ещё до запроса.

Smoke выводит только валидный design и разрешённую telemetry с redaction известных ключей и общих credential patterns. Нет prompts, headers, raw response, stack или .env. Независимые snapshots исключают повторные ссылки `[CIRCULAR]`. Неизвестные usage поля не выдаются за ноль. Доступная telemetry сохраняется в workflow.executions; будущий collector должен исключать goal. [Учёт расходов/Admin — PLANNED](USAGE-COST-ADMIN-PLAN.md).
