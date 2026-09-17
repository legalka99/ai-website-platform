import { NavLink } from "react-router";
import { humanLabel } from "./labels.js";
import type { PlatformRole } from "../../../packages/core/src/admin-api.js";

// Information architecture only. Server authorization remains the access boundary.
export const navigationGroups = [
  { label: "УПРАВЛЕНИЕ СИСТЕМОЙ", items: [["", "Обзор"], ["workflows", "Процессы"], ["websites", "Сайты"], ["qa", "QA"], ["usage", "Использование ИИ"], ["audit", "Аудит"], ["system", "Система"]] },
  { label: "КЛИЕНТЫ", items: [["organizations", "Организации"], ["users", "Пользователи"], ["projects", "Проекты"]] },
  { label: "ФИНАНСЫ И ОТЧЁТНОСТЬ", items: [["finance", "Финансы"]] },
] as const;

/** Local console availability, not a claim about server health or business metrics. */
export function ConsoleStatus() {
  return <p className="sidebar-mode"><span className="console-indicator" aria-hidden="true" />Только просмотр</p>;
}
export function SidebarNavigation() {
  return <nav className="grouped-navigation" aria-label="Основная навигация">
    {navigationGroups.map((group, index) => <section className="nav-group" key={group.label} aria-labelledby={`nav-group-${index}`}>
      <h2 id={`nav-group-${index}`} className="nav-category">{group.label}</h2>
      {group.items.map(([path, label]) => <NavLink key={path} end={path === ""} to={"/admin" + (path ? "/" + path : "")}>{label}</NavLink>)}
    </section>)}
  </nav>;
}
export function SidebarFooter({ role }: { role: PlatformRole }) {
  return <div className="sidebar-footer">
    <p className="sidebar-role">{humanLabel(role)}</p>
    <nav aria-label="Настройки панели"><NavLink to="/admin/settings">Настройки</NavLink></nav>
  </div>;
}
