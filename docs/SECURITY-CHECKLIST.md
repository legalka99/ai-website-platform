# Security checklist — Kleo

Статус на 15 сентября 2026. Отметки относятся только к названному слою.

## Implemented now

- [x] Отдельный packages/security, разделение ответственности.
- [x] SecretProvider interface и local/test scoped store, credential refs без токенов, повторная tenant/provider проверка.
- [x] Общая redaction, structured allowlist logger, безопасные provider errors.
- [x] Ресурсная граница входа и повторно используемая DATA policy; Business runtime validator сохранён.
- [x] Authorization policy по actor/project/org/permission, role matrix.
- [x] URL/DNS/redirect policy с блокировкой внутренних сетей, metadata и credentials.
- [x] Test webhook HMAC verifier, raw body, timestamp, constant-time check, in-memory replay prevention.
- [x] Tool permissions и одноразовое approval точного preview, без исполнения.
- [x] Upload metadata policy и default-deny SandboxRunner.
- [x] HTTP defaults config, in-memory rate limiter и AI cost guard.
- [x] Серверная фабрика Business Agent через SecretProvider и guard, usage project/workflow scope.
- [x] Smoke: ручной opt-in, один запрос, redaction, проверка `.env` metadata; права существующего `.env` ограничены до 600.
- [x] Локальные secret scan (включая archives), static security check, dependency audit scripts.
- [x] Threat model, private reporting и incident/backup rules.

## Planned before local MVP

- [ ] Подключить guards ко всем новым серверным путям и реальному хранилищу; протестировать обход через альтернативный маршрут.
- [ ] Явно утверждённый live Business smoke и проверка качества профиля; на этом этапе не запускался.
- [ ] Подключать Design только через серверную фабрику/общий cost guard и структурированную валидацию.
- [ ] Безопасное сохранение проектов/версий с projectId, отмена задач и наблюдаемый лимит расходов.
- [ ] Изоляция preview origin, безопасный renderer, sanitization и проверка XSS.
- [ ] Декодирование/повторное кодирование изображений с пиксельными лимитами; карантин и storage outside web root.
- [ ] При первом URL fetch — pinned transport, таймаут DNS/сети/тела, проверка peer IP; обычный fetch после validateURL недопустим.

## Planned before public pilot

- [ ] Настоящая аутентификация, сессии, MFA администраторов, recovery и отзыв сессий.
- [ ] Сквозная API/storage авторизация и cross-tenant/IDOR тесты, row-level или эквивалентные ограничения.
- [ ] HTTP middleware: HTTPS, trusted proxy, cookies, CSRF, CORS, CSP, HSTS, request limits.
- [ ] Production SecretProvider, service identities и scoped secrets без dotenv рядом с кодом.
- [ ] Durable атомарные webhook replay, approvals и распределённые rate/concurrency/budget limits.
- [ ] Проверка реального CMS протокола и подписи, минимальные полномочия integration token.
- [ ] Хранилище audit events, фильтрация, доступ, retention и оповещения.
- [ ] Отдельный security review/penetration test и устранение существенных findings.
- [ ] Проверенное восстановление из независимой зашифрованной резервной копии.

## Production required

- [ ] Reverse proxy/WAF/DDoS protection и egress firewall выбранного окружения.
- [ ] Разделение процессов, сети и credentials по service identity; компрометация одного процесса не даёт весь доступ.
- [ ] Изолированный sandbox до любого выполнения сгенерированного кода.
- [ ] Off-site versioned/immutable encrypted backups, least privilege, отдельные credentials, регулярные restore drills.
- [ ] Мониторинг security/usage, ротация, реагирование, обновления и контроль supply chain.
- [ ] Подтверждённые RPO/RTO, план восстановления и приватный канал уведомления об инциденте.

Partially implemented: tenant isolation, SSRF, webhook security, auth, approvals, uploads, HTTP и cost controls имеют проверяемую основу; это не сквозная защита production-сервиса.
