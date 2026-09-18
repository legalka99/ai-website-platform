import { WorkflowLaunch } from "./workflow-launch.js";
import { CreateResource, BriefPage, BriefSummary } from "./owner-forms.js";
import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
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
import { titles, humanLabel, numberLabel } from "./labels.js";
import { Finance, FinanceOverview } from "./finance.js";
import { ConsoleStatus, SidebarNavigation, SidebarFooter } from "./sidebar.js";
import { Settings } from "./settings.js";
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
    document.title = "AiVeron — Панель владельца";
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
          description="Панель доступна только владельцу и администраторам платформы."
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
        <ConsoleStatus />
        <SidebarNavigation />
        <SidebarFooter role={user.platformRole} />
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-label">Управление платформой</span>
          <div className="account">
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
            <Route path="/admin/organizations/new" element={<CreateResource owner={user.platformRole === "platform_owner"} />} />
            <Route path="/admin/organizations/:organizationId/projects/new" element={<CreateResource project owner={user.platformRole === "platform_owner"} />} />
            <Route path="/admin/projects/:projectId/brief" element={<BriefPage owner={user.platformRole === "platform_owner"} />} />
            <Route path="/admin/finance" element={<Finance />} />
            <Route path="/admin/settings" element={<Settings user={user} />} />
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
                element={<ListPage key={kind} kind={kind} owner={user.platformRole === "platform_owner"} />}
              />
            ))}
            {(["organizations", "users", "projects", "workflows"] as const).map(
              (kind) => (
                <Route
                  key={kind}
                  path={`/admin/${kind}/:id`}
                  element={<DetailPage key={kind} kind={kind} owner={user.platformRole === "platform_owner"} />}
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
          AiVeron · Панель владельца{" "}
          <span>Время: {timezone}</span>
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
          ? "Не удалось войти. Проверьте электронную почту и пароль."
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
          <span className="overline">ПАНЕЛЬ ВЛАДЕЛЬЦА</span>
          <h1>Вход в панель</h1>
          <p>Для владельца и администраторов AiVeron.</p>
          <form onSubmit={(e) => void submit(e)}>
            <label htmlFor="email">Электронная почта</label>
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
              {busy ? "Вход…" : "Войти"}
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
        description="Сохранённое состояние AiVeron — от организации до результата ИИ."
        action={<span className="read-only">Только просмотр</span>}
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
                  <strong>{numberLabel(r.data!.counts[kind])}</strong>
                  <small>
                    Всего в платформе <span aria-hidden="true">→</span>
                  </small>
                  <span className="metric-index">0{i + 1}</span>
                </Link>
              ),
            )}
          </div>
          <FinanceOverview linked />
          <section className="panel">
            <div className="panel-title">
              <h2>Последние процессы</h2>
              <Link to="/admin/workflows">Все процессы →</Link>
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
              <Link to="/admin/audit">Аудит →</Link>
            </div>
            <DataTable kind="audit-events" rows={r.data.audit} />
          </section>
        </>
      )}
    </>
  );
}
function ListPage({ kind, owner = false }: { kind: AdminKind; owner?: boolean }) {
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
        action={kind === "organizations" && owner ? <Link className="related-action" to="/admin/organizations/new">Создать организацию</Link> : undefined}
        description={
          kind === "usage"
            ? "Сохранённые попытки обращений к ИИ. Неизвестное число токенов не заменяется нулём. Денежный учёт ещё не подключён."
            : kind === "audit-events"
              ? "События входа и административного доступа. Журнал аудита не заменяет мониторинг безопасности."
              : "Серверная сортировка · до 20 записей на странице."
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
  kind, owner = false,
}: {
  kind: "organizations" | "users" | "projects" | "workflows"; owner?: boolean;
}) {
  const [detailParams] = useSearchParams();
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
        eyebrow="СВЕДЕНИЯ О ЗАПИСИ"
        title={
          r.data?.item.name ??
          (kind === "workflows"
            ? "Процесс"
            : kind === "users"
              ? "Пользователь"
              : "Подробности")
        }
        description="Сохранённые данные записи и связанные ресурсы."
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
          {kind === "projects" && <>
            {detailParams.get("briefSaved") === "1" && <p role="status">Бриф сохранён. Актуальные данные показаны ниже.</p>}
            <BriefSummary projectId={id!} owner={owner} />
            <WorkflowLaunch key={id} projectId={id!} name={r.data.item.name ?? "Проект"} active={r.data.item.status === "active"} owner={owner} />
          </>}
          {kind === "workflows" && r.data.item.source_brief_version_id && r.data.item.project_id && <WorkflowLaunch projectId={r.data.item.project_id} workflowId={id} name="Проект" active={false} owner={false} />}
          <nav className="related" aria-label="Связанные данные">
            {kind === "organizations" && (
              <>
                {owner && <Link to={`/admin/organizations/${id}/projects/new`}>Создать проект</Link>}
                <Link to={`/admin/projects?organizationId=${id}`}>
                  Проекты организации →
                </Link>
                <Link to={`/admin/workflows?organizationId=${id}`}>
                  Процессы организации →
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
                <Link to={`/admin/usage?workflowId=${id}`}>Использование ИИ →</Link>
                <Link to={`/admin/qa?workflowId=${id}`}>QA →</Link>
              </>
            )}
          </nav>
          {r.data.executions && !r.data.item.source_brief_version_id && (
            <section className="panel">
              <div className="panel-title">
                <h2>Этапы выполнения</h2>
                <span>Только сохранённые выполнения</span>
              </div>
              {r.data.executions.length ? (
                <ol className="timeline">
                  {r.data.executions.map((e) => (
                    <li key={e.id}>
                      <strong>{humanLabel(e.agent_type)}</strong>
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
        description="Доступность API и текущий доступ. Проверка не запускает ИИ."
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
            <dd>{humanLabel(role)}</dd>
          </div>
          <div>
            <dt>Режим панели</dt>
            <dd>{role === "platform_owner" ? "Создание проектов и сохранение брифа" : "Только просмотр"}</dd>
          </div>
          <div>
            <dt>Готовность базы данных</dt>
            <dd>Отдельная проверка не предоставлена</dd>
          </div>
          <div>
            <dt>Денежная стоимость ИИ</dt>
            <dd>Учёт ещё не подключён</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
