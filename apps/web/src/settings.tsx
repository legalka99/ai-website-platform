import { Link, useSearchParams } from "react-router";
import type { SessionView } from "../../../packages/core/src/admin-api.js";
import { Header } from "./components.js";
import { humanLabel } from "./labels.js";

/** Profile is a projection of the existing authenticated session, never a separate store. */
export function Settings({ user }: { user: SessionView["user"] }) {
  const [params] = useSearchParams();
  const employees = params.get("section") === "employees";
  return <>
    <Header title="Настройки" description="Профиль и сотрудники платформы. Только просмотр." />
    <nav className="finance-tabs" aria-label="Разделы настроек">
      <Link to="/admin/settings" aria-current={!employees ? "page" : undefined}>Профиль</Link>
      <Link to="/admin/settings?section=employees" aria-current={employees ? "page" : undefined}>Сотрудники</Link>
    </nav>
    {employees ? <section className="panel" aria-label="Сотрудники">
      <div className="panel-title"><h2>Сотрудники</h2></div>
      <div className="state empty">
        <h2>Учёт сотрудников ещё не подключён</h2>
        <p>Список пользователей включает клиентов и не является списком сотрудников платформы.</p>
        <p>После подключения учёта здесь появятся ФИО, электронная почта, телефон, мессенджеры, роль и статус. Отсутствующие сведения будут обозначены «Не указано».</p>
      </div>
    </section> : <section className="panel" aria-label="Профиль">
      <div className="panel-title"><h2>Профиль</h2></div>
      <dl className="metadata">
        <div><dt>Электронная почта</dt><dd>{user.email}</dd></div>
        <div><dt>Роль</dt><dd>{humanLabel(user.platformRole)}</dd></div>
      </dl>
    </section>}
  </>;
}
