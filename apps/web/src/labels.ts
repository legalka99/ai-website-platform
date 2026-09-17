import type { AdminKind } from "../../../packages/core/src/admin-api.js";
export const titles: Record<AdminKind, string> = {
  organizations: "Организации", users: "Пользователи", projects: "Проекты",
  workflows: "Процессы", websites: "Сайты", versions: "Версии сайтов",
  qa: "Контроль качества", usage: "Использование ИИ", "audit-events": "Аудит",
};
const values: Record<string, string> = {
  platform_owner: "Владелец платформы", platform_admin: "Администратор платформы", user: "Пользователь",
  owner: "Владелец", admin: "Администратор", member: "Участник", viewer: "Наблюдатель",
  pending: "Ожидает", running: "Выполняется", completed: "Завершён", failed: "Ошибка", cancelled: "Отменён",
  active: "Активен", disabled: "Отключён", archived: "В архиве", draft: "Черновик", published: "Опубликован",
  success: "Успешно", failure: "Ошибка", revoked: "Отозван", unknown: "Неизвестно", qa_failed: "QA не пройдено",
  PASS: "PASS — Пройдено", FAIL: "FAIL — Не пройдено",
  info: "Информация", warning: "Предупреждение", error: "Ошибка", critical: "Критическая",
  Online: "Доступен", Unavailable: "Недоступно", unavailable: "Недоступно",
  business: "Анализ бизнеса", design: "Дизайн", content: "Контент", developer: "Разработка", qa: "QA",
  platform_read: "Просмотр администратором", login_success: "Успешный вход", login_failure: "Ошибка входа", access_denied: "Доступ запрещён", project_created: "Создание проекта",
  logout: "Выход", bootstrap_owner: "Создание владельца", identity: "Учётная запись",
  users: "Пользователи", organizations: "Организации", projects: "Проекты", workflows: "Процессы",
};
export const humanLabel = (value: unknown): string => {
  const key = String(value ?? "unavailable");
  return Object.hasOwn(values, key) ? values[key]! : key;
};
/** Integer telemetry remains exact even above Number.MAX_SAFE_INTEGER. Null is never zero. */
export function numberLabel(value: unknown): string {
  if (value == null) return "Недоступно";
  if (typeof value === "string" && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    const [whole, fraction] = value.split(".");
    return new Intl.NumberFormat("ru-RU").format(BigInt(whole!)) + (fraction === undefined ? "" : "," + fraction);
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Intl.NumberFormat("ru-RU").format(value);
  return String(value);
}
