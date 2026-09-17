import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router";
import type {
  AdminDashboard,
  AdminDetail,
  AdminKind,
  AdminList,
  SessionView,
} from "../../../packages/core/src/admin-api.js";
import { BrandLogo } from "./brand.js";
import { api, ApiError } from "./api.js";
import {
  Badge,
  DataTable,
  ErrorState,
  Header,
  Loading,
  Metadata,
  timezone,
  useRemote,
} from "./components.js";

const sections: [string, string][] = [
  ["", "Обзор"],
  ["organizations", "Организации"],
  ["users", "Пользователи"],
  ["projects", "Проекты"],
  ["workflows", "Workflows"],
  ["websites", "Websites"],
  ["qa", "QA"],
  ["usage", "AI Usage"],
  ["audit", "Audit"],
  ["system", "Система"],
];
const titles: Record<AdminKind, string> = {
  organizations: "Организации",
  users: "Пользователи",
  projects: "Проекты",
  workflows: "Workflows",
  websites: "Websites",
  versions: "Версии сайтов",
  qa: "Контроль качества",
  usage: "AI Usage",
  "audit-events": "Audit",
};
function Brand() {
  return (
    <Link className="brand" to="/admin" aria-label="AiVeron — обзор">
      <BrandLogo />
    </Link>
  );
}
export function App() {
  const [user, setUser] = useState<SessionView["user"] | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<Error>(),
    [logoutError, setLogoutError] = useState<Error>(),
    [loggingOut, setLoggingOut] = useState(false),
    [reload, setReload] = useState(0);
  const location = useLocation();
  useEffect(() => {
    const c = new AbortController();
    api.onUnauthorized = () => {
      setUser(null);
      setError(undefined);
    };
    setLoading(true);
    setError(undefined);
    void api
      .me(c.signal)
      .then((u) => {
        if (!c.signal.aborted) setUser(u);
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted && !(e instanceof ApiError && e.status === 401))
          setError(e instanceof ApiError ? e : new ApiError(0));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      c.abort();
      api.onUnauthorized = () => {};
    };
  }, [reload]);
  useEffect(() => {
    document.title = "AiVeron Console";
    document.querySelector<HTMLElement>("h1")?.focus();
  }, [location.pathname]);
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await api.logout();
      setUser(null);
    } catch (e) {
      setLogoutError(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      setLoggingOut(false);
    }
  };
  if (loading)
    return (
      <main className="startup">
        <Brand />
        <Loading />
      </main>
    );
  if (error)
    return (
      <main className="startup">
        <Brand />
        <ErrorState error={error} retry={() => setReload((v) => v + 1)} />
      </main>
    );
  if (!user)
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <Login
              onLogin={(u) => {
                setUser(u);
                setLogoutError(undefined);
              }}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  if (!["platform_owner", "platform_admin"].includes(user.platformRole))
    return (
      <main className="startup">
        <Brand />
        <Header
          title="Доступ запрещён"
          description="Console доступна только владельцу и администраторам платформы."
        />
        <p>Роль организации не предоставляет доступ к управлению AiVeron.</p>
        {logoutError && <ErrorState error={logoutError} />}
        <button onClick={() => void logout()} disabled={loggingOut}>
          Выйти из аккаунта
        </button>
      </main>
    );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        К содержимому
      </a>
      <aside className="sidebar">
        <Brand />
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Основная навигация">
          {sections.map(([path, label], i) => (
            <NavLink
              key={path}
              end={path === ""}
              to={"/admin" + (path ? "/" + path : "")}
            >
              <span className="nav-index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          Read-only console
          <p>
            Наблюдение за платформой.
            <br />
            Изменение данных недоступно.
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-label">Platform administration</span>
          <div className="account">
            <span className="account-email">{user.email}</span>
            <Badge value={user.platformRole} />
            <button
              className="subtle"
              onClick={() => void logout()}
              disabled={loggingOut}
            >
              {loggingOut ? "Выход…" : "Выйти"}
            </button>
          </div>
        </header>
        <main id="main">
          {logoutError && <ErrorState error={logoutError} />}
          <Routes>
            <Route path="/admin" element={<Dashboard />} />
            {(
              [
                "organizations",
                "users",
                "projects",
                "workflows",
                "websites",
                "versions",
                "qa",
                "usage",
              ] as const
            ).map((kind) => (
              <Route
                key={kind}
                path={`/admin/${kind}`}
                element={<ListPage key={kind} kind={kind} />}
              />
            ))}
            {(["organizations", "users", "projects", "workflows"] as const).map(
              (kind) => (
                <Route
                  key={kind}
                  path={`/admin/${kind}/:id`}
                  element={<DetailPage key={kind} kind={kind} />}
                />
              ),
            )}
            <Route
              path="/admin/audit"
              element={<ListPage kind="audit-events" />}
            />
            <Route
              path="/admin/system"
              element={<System role={user.platformRole} />}
            />
            <Route path="/login" element={<Navigate to="/admin" replace />} />
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route
              path="*"
              element={
                <>
                  <Header
                    title="Страница не найдена"
                    description="Проверьте адрес или вернитесь к обзору."
                  />
                  <Link to="/admin">К обзору</Link>
                </>
              }
            />
          </Routes>
        </main>
        <footer className="footer">
          AiVeron · Owner / Admin Console{" "}
          <span>Время: {timezone} · Только чтение</span>
        </footer>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: SessionView["user"]) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      email = String(data.get("email") ?? ""),
      password = String(data.get("password") ?? "");
    form.reset();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(email, password));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "Не удалось войти. Проверьте email и пароль."
          : e instanceof ApiError
            ? e.message
            : "Сервис недоступен. Повторите позже.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-panel">
        <div className="login-card">
          <Brand />
          <span className="overline">OWNER CONSOLE</span>
          <h1>Вход в Console</h1>
          <p>Для владельца и администраторов AiVeron.</p>
          <form onSubmit={(e) => void submit(e)}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
              disabled={busy}
            />
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="current-password"
              disabled={busy}
            />
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Вход…" : "Войти в Console"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="login-hint">
            Доступ выдаётся отдельно. Публичная регистрация закрыта.
          </p>
        </div>
      </section>
    </main>
  );
}
function Dashboard() {
  const r = useRemote<AdminDashboard>("/api/v1/admin/dashboard");
  return (
    <>
      <Header
        title="Обзор платформы"
        description="Сохранённое состояние AiVeron — от организации до результата AI."
        action={<span className="read-only">READ ONLY</span>}
      />
      {r.error ? (
        <ErrorState error={r.error} retry={r.retry} />
      ) : !r.data ? (
        <Loading />
      ) : (
        <>
          <div className="metrics">
            {(["organizations", "users", "projects", "workflows"] as const).map(
              (kind, i) => (
                <Link className="metric" to={`/admin/${kind}`} key={kind}>
                  <span>{titles[kind]}</span>
                  <strong>{r.data!.counts[kind]}</strong>
                  <small>
                    Всего в платформе <span aria-hidden="true">→</span>
                  </small>
                  <span className="metric-index">0{i + 1}</span>
                </Link>
              ),
            )}
          </div>
          <section className="panel">
            <div className="panel-title">
              <h2>Последние workflows</h2>
              <Link to="/admin/workflows">Все workflows →</Link>
            </div>
            <DataTable kind="workflows" rows={r.data.workflows} />
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Последние проверки QA</h2>
              <Link to="/admin/qa">Все проверки →</Link>
            </div>
            <DataTable kind="qa" rows={r.data.qa} />
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Последние события доступа</h2>
              <Link to="/admin/audit">Audit →</Link>
            </div>
            <DataTable kind="audit-events" rows={r.data.audit} />
          </section>
        </>
      )}
    </>
  );
}
function ListPage({ kind }: { kind: AdminKind }) {
  const [params, setParams] = useSearchParams(),
    raw = params.get("offset") ?? "0",
    valid = /^(?:0|[1-9][0-9]{0,3}|10000)$/.test(raw),
    offset = valid ? Number(raw) : 0;
  const query = new URLSearchParams(params);
  query.set("limit", "20");
  if (!query.has("offset")) query.set("offset", "0");
  const r = useRemote<AdminList>(`/api/v1/admin/${kind}?${query}`);
  const change = (next: number) => {
    const q = new URLSearchParams(params);
    q.set("offset", String(next));
    setParams(q);
  };
  return (
    <>
      <Header
        title={titles[kind]}
        description={
          kind === "usage"
            ? "Сохранённые обращения к AI. Недоступные token counts не заменяются нулём. Стоимость: planned."
            : kind === "audit-events"
              ? "События authentication и административного доступа. Это Audit, не Sentinel."
              : "Серверная сортировка · до 20 записей на странице · только чтение."
        }
      />
      {params.size > 0 && (
        <div className="filter-note">
          Выбран срез данных{" "}
          <Link to={`/admin/${kind === "audit-events" ? "audit" : kind}`}>
            Сбросить
          </Link>
        </div>
      )}
      <section className="panel">
        {r.error ? (
          <ErrorState error={r.error} retry={r.retry} />
        ) : !r.data ? (
          <Loading />
        ) : (
          <>
            <DataTable kind={kind} rows={r.data.data} />
            <div className="pagination">
              <span>
                Страница {Math.floor(offset / 20) + 1} · {r.data.data.length}{" "}
                записей
              </span>
              <div>
                <button
                  disabled={offset === 0}
                  onClick={() => change(Math.max(0, offset - 20))}
                >
                  Назад
                </button>
                <button
                  disabled={r.data.data.length < 20 || offset + 20 > 10000}
                  onClick={() => change(offset + 20)}
                >
                  Далее
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
function DetailPage({
  kind,
}: {
  kind: "organizations" | "users" | "projects" | "workflows";
}) {
  const { id } = useParams(),
    r = useRemote<AdminDetail>(
      `/api/v1/admin/${kind}/${encodeURIComponent(id ?? "")}`,
    );
  return (
    <>
      <Link className="back" to={`/admin/${kind}`}>
        ← {titles[kind]}
      </Link>
      <Header
        eyebrow="RECORD DETAILS"
        title={
          r.data?.item.name ??
          (kind === "workflows"
            ? "Workflow"
            : kind === "users"
              ? "Пользователь"
              : "Подробности")
        }
        description="Серверные данные записи. Изменения недоступны."
      />
      {r.error ? (
        <ErrorState error={r.error} retry={r.retry} />
      ) : !r.data ? (
        <Loading />
      ) : (
        <>
          <section className="panel">
            <Metadata row={r.data.item} />
          </section>
          <nav className="related" aria-label="Связанные данные">
            {kind === "organizations" && (
              <>
                <Link to={`/admin/projects?organizationId=${id}`}>
                  Проекты организации →
                </Link>
                <Link to={`/admin/workflows?organizationId=${id}`}>
                  Workflows организации →
                </Link>
              </>
            )}
            {kind === "projects" && (
              <>
                <Link
                  to={`/admin/organizations/${r.data.item.organization_id}`}
                >
                  Организация →
                </Link>
                {["workflows", "websites", "versions", "qa", "usage"].map(
                  (k) => (
                    <Link key={k} to={`/admin/${k}?projectId=${id}`}>
                      {titles[k as AdminKind]} →
                    </Link>
                  ),
                )}
              </>
            )}
            {kind === "workflows" && (
              <>
                <Link to={`/admin/projects/${r.data.item.project_id}`}>
                  Проект →
                </Link>
                <Link to={`/admin/usage?workflowId=${id}`}>AI Usage →</Link>
                <Link to={`/admin/qa?workflowId=${id}`}>QA →</Link>
              </>
            )}
          </nav>
          {r.data.executions && (
            <section className="panel">
              <div className="panel-title">
                <h2>Этапы выполнения</h2>
                <span>Только сохранённые executions</span>
              </div>
              {r.data.executions.length ? (
                <ol className="timeline">
                  {r.data.executions.map((e) => (
                    <li key={e.id}>
                      <strong>{e.agent_type}</strong>
                      <Badge value={e.status} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="state">Нет сохранённых этапов.</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
function System({ role }: { role: string }) {
  const r = useRemote<{ status: string }>("/health");
  return (
    <>
      <Header
        title="Состояние системы"
        description="Доступность API и текущий доступ. Проверка не запускает AI."
      />
      <section className="panel system-panel">
        <h2>HTTP API</h2>
        {r.error ? (
          <ErrorState error={r.error} retry={r.retry} />
        ) : !r.data ? (
          <Loading />
        ) : (
          <Badge value={r.data.status === "ok" ? "Online" : "Unavailable"} />
        )}
        <dl className="metadata">
          <div>
            <dt>Текущая роль</dt>
            <dd>{role}</dd>
          </div>
          <div>
            <dt>Режим Console</dt>
            <dd>Read-only</dd>
          </div>
          <div>
            <dt>DB readiness</dt>
            <dd>Отдельная проверка не предоставлена</dd>
          </div>
          <div>
            <dt>Денежная стоимость AI</dt>
            <dd>Planned</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
