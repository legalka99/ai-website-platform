# Threat model — Kleo

Версия 0.1, 15 сентября 2026. Активы: пользовательские проекты, credentials, AI бюджет, будущие сессии/база, CMS, хост и возможность восстановления. Модель атаки включает недоверенный внешний контент и компрометацию отдельного компонента. Node.js модули в одном процессе не являются OS sandbox. Public ingress, DB, renderer и CMS ещё не реализованы: их защиты нельзя считать завершёнными.

| Угроза | Asset | Attack path | Prevention | Detection | Recovery | Current status |
|---|---|---|---|---|---|---|
| Secret theft | API/CMS keys | prompt, логи, доступ к процессу | Scoped refs/redaction/agent capability separation; service isolation Planned | Проверка secrets scan сейчас; alerting Planned | Revoke/rotate, проверка usage | Partially implemented |
| Account takeover | Аккаунты и сессии | украденный пароль/сессия | Auth/MFA/session rotation до пилота | Login alerts Planned | Отзыв сессий и recovery | Planned |
| Cross-tenant access | Данные клиентов | чужой projectId/secretRef | Policy+double scoped lookup; storage constraints Planned | Отрицательные тесты сейчас, audit Planned | Изоляция проекта, расследование доступа | Partially implemented |
| IDOR | Проекты/файлы/версии | прямой запрос известного ID | actor→project→permission; future API enforces every route | Policy tests; API access audit Planned | Отзыв доступа, исправить все пути | Partially implemented |
| Prompt injection | Инструкции/данные/возможности AI | вредоносный текст сайта или пользователя | DATA policy, отсутствие tools/secrets в prompt, server authorization | Тесты четырёх атак; production evals Planned | Остановить workflow, пересмотреть результат | Partially implemented |
| SSRF | Внутренняя сеть/metadata | URL, redirect, DNS rebinding | URL/DNS policy сейчас; pinned transport+egress firewall до fetch | Negative tests; egress logs Planned | Отключить fetch, rotate exposed keys | Partially implemented |
| SQL injection | Будущая база | строковая сборка запросов | Parameterized queries, ORM discipline, minimum DB rights | DB tests/audit Planned | Изолировать DB, restore verified data | Planned; DB отсутствует |
| XSS | Сессии/preview | сгенерированный HTML/JS | Изолированный preview origin, escaping/sanitization, CSP | Browser regression tests Planned | Снять опасную версию, отозвать сессии | Planned; renderer отсутствует |
| CSRF | Действия пользователя | чужой сайт и cookie | SameSite config; token+Origin middleware Planned | API tests Planned | Отзыв сессий, проверка действий | Partially implemented: config only |
| Malicious file | Обработчик/хранилище | traversal, polyglot, image bomb | Размер, имя, extension/MIME/magic; re-encode/quarantine Planned | Traversal tests; decoder tests Planned | Карантин/удаление публикации, patch decoder | Partially implemented |
| Malicious CMS response | Состояние проекта | поддельные/вредоносные ответы | Общая input boundary; adapter schema и минимизация данных Planned | Adapter malformed tests Planned | Отключить адаптер, восстановить версию | Partially implemented |
| Webhook spoofing | Запуски/действия | неподписанный payload/replay | Test HMAC raw body, timestamp, replay; real protocol/shared store Planned | Тесты сейчас, signature alerts Planned | Отключить endpoint, rotate signing key | Partially implemented |
| Supply chain | Сборка/релиз | подмена пакета/CI | Lockfile, audit script; trusted builds/provenance Planned | npm audit сейчас, CI scanning Planned | Pin/revert, rebuild clean, rotate CI secrets | Partially implemented |
| Dependency compromise | Код/credentials процесса | вредоносный dependency update | Минимальные dependencies; review/sandboxed install pipeline Planned | Audit известной базы; поведенческий контроль Planned | Rollback, расследовать доступ/rotate | Partially implemented |
| Code execution | Хост/сеть/данные | AI output→shell/eval | DisabledSandboxRunner и static check; runtime isolation Planned | Default-deny test сейчас | Изолировать хост, clean rebuild | Implemented отказ; sandbox Planned |
| Data exfiltration | Контент/секреты | tools, URL, prompts, logs | Allowlist input/tools/logs; сеть и DLP ограничения Planned | Offline capability tests; monitoring Planned | Остановить канал, выяснить scope, notify | Partially implemented |
| Cost abuse | API бюджет | циклы/retries/параллельные запросы | Output/RPM/workflow/concurrency guard, retries=0, smoke opt-in | Локальные тесты/usage; budget alerts Planned | Остановить генерацию/отозвать key, inspect usage | Partially implemented: single process |
| DDoS | Доступность | массовый трафик | Rate interface и body limits; proxy/WAF/provider mitigation Planned | Infrastructure metrics Planned | Ограничить ingress, включить mitigation | Planned infrastructure |
| Backup destruction | Восстановление | компрометация primary/admin | Отдельные identities, versioned/immutable backups | Restore drills/backup alerts Planned | Restore off-site проверенной версии | Planned |
| Admin compromise | Все привилегии | фишинг/admin session | MFA, least privilege, разделение администрирования | Admin audit/alerts Planned | Revoke admin, rotate, investigate backups | Planned |
| Leaked logs | Secrets/PII | raw error/body/debug | Allowlist structured logs, redaction, debug off | Unit tests сейчас, log access audit Planned | Ограничить доступ, purge по процедуре, rotate | Partially implemented |
| Compromised integration token | CMS сайта | утечка scoped token | Secret refs и project/provider isolation; scoped provider rights Planned | Provider audit/usage Planned | Revoke token, reauthorize, restore site | Partially implemented |

Риск принимается только для локальной разработки с учебными данными. Публичный запуск требует закрытия пунктов Checklist, интеграционных тестов реальных границ и отдельного review. Foundation тесты не доказывают устойчивость к arbitrary code execution внутри сервера, сложным prompt injection, распределённым атакам или неизвестным уязвимостям dependencies.

Выявлено и исправлено в этом этапе: права локального `.env` 644 → 600; отсутствие общей tenant/secret/tool/rate policy; неограниченная schema провайдера и отсутствие отдельной отмены stalled response body. Архивы проверены эвристическим scanner без выявленных совпадений. История Git целиком не сканировалась. Независимый внешний аудит не проводился.
