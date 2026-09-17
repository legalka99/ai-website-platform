import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, ApiError } from "./api.js";
import type {
  AdminKind,
  AdminRow,
} from "../../../packages/core/src/admin-api.js";

export function useRemote<T>(path: string) {
  const [state, setState] = useState<{ path: string; data?: T; error?: Error }>(
      { path },
    ),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    void api
      .request<T>(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ path, data });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setState({
            path,
            error: e instanceof ApiError ? e : new ApiError(0),
          });
      });
    return () => controller.abort();
  }, [path, retry]);
  return {
    ...(state.path === path ? state : { path }),
    retry: () => setRetry((v) => v + 1),
  };
}
export function Loading() {
  return (
    <div className="state" role="status">
      <span className="loader" />
      Загрузка данных…
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className="state error" role="alert">
      <h2>
        {error instanceof ApiError && error.status === 403
          ? "Доступ запрещён"
          : "Не удалось выполнить запрос"}
      </h2>
      <p>{error.message}</p>
      {retry &&
        !(error instanceof ApiError && [401, 403].includes(error.status)) && (
          <button onClick={retry}>Повторить</button>
        )}
    </div>
  );
}
export function Header({
  eyebrow = "PLATFORM OVERVIEW",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Badge({ value }: { value: unknown }) {
  const text = String(value ?? "unavailable");
  return (
    <span
      className={`badge ${["active", "completed", "PASS", "success"].includes(text) ? "good" : ["FAIL", "failed", "critical", "error", "disabled"].includes(text) ? "bad" : ["warning", "running", "qa_failed"].includes(text) ? "warn" : ""}`}
    >
      {text}
    </span>
  );
}
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const timezone = zone;
export function display(value: unknown, key = ""): ReactNode {
  if (value === null || value === undefined)
    return <span className="muted">Недоступно</span>;
  if (key.endsWith("_at")) {
    const date = new Date(String(value));
    return Number.isNaN(date.valueOf()) ? (
      "Недоступно"
    ) : (
      <time dateTime={date.toISOString()}>
        {new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: zone,
        }).format(date)}
      </time>
    );
  }
  if (["status", "outcome", "severity", "role"].includes(key))
    return <Badge value={value} />;
  if (key === "passed") return <Badge value={value ? "PASS" : "FAIL"} />;
  return String(value);
}
const labels: Record<string, string> = {
  id: "ID",
  name: "Название",
  email: "Email",
  status: "Статус",
  role: "Роль платформы",
  organization_id: "Организация",
  project_id: "Проект",
  website_id: "Website",
  website_version_id: "Версия",
  workflow_run_id: "Workflow",
  created_at: "Создано",
  updated_at: "Обновлено",
  started_at: "Начало",
  completed_at: "Завершение",
  recorded_at: "Время",
  passed: "QA",
  score: "Score",
  version_number: "Версия",
  provider: "Provider",
  model: "Model",
  agent_type: "Agent",
  outcome: "Результат",
  input_tokens: "Input",
  output_tokens: "Output",
  cached_input_tokens: "Cached",
  total_tokens: "Total tokens",
  duration_ms: "Время, ms",
  event_type: "Событие",
  actor_id: "Actor",
  resource_type: "Ресурс",
  resource_id: "Resource ID",
  request_id: "Request ID",
  attempt: "Attempt",
};
const columns: Record<AdminKind, readonly (keyof AdminRow)[]> = {
  organizations: ["name", "id", "status", "created_at"],
  users: ["email", "id", "status", "role", "created_at"],
  projects: ["name", "organization_id", "status", "created_at", "updated_at"],
  workflows: [
    "id",
    "project_id",
    "organization_id",
    "status",
    "started_at",
    "completed_at",
  ],
  websites: ["id", "project_id", "status", "created_at"],
  versions: [
    "id",
    "version_number",
    "website_id",
    "status",
    "workflow_run_id",
    "created_at",
  ],
  qa: ["id", "project_id", "passed", "score", "created_at"],
  usage: [
    "provider",
    "model",
    "agent_type",
    "outcome",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "total_tokens",
    "duration_ms",
    "recorded_at",
    "project_id",
    "workflow_run_id",
  ],
  "audit-events": [
    "created_at",
    "event_type",
    "actor_id",
    "resource_type",
    "resource_id",
    "request_id",
  ],
};
function rowLink(kind: AdminKind, row: AdminRow): string | undefined {
  if (!/^[a-f0-9-]{36}$/.test(row.id)) return;
  if (["organizations", "users", "projects", "workflows"].includes(kind))
    return `/admin/${kind}/${encodeURIComponent(row.id)}`;
  if (kind === "websites")
    return `/admin/versions?websiteId=${encodeURIComponent(row.id)}`;
}
export function DataTable({
  kind,
  rows,
  caption,
}: {
  kind: AdminKind;
  rows: AdminRow[];
  caption?: string;
}) {
  if (!rows.length)
    return (
      <div className="state empty">
        <h2>Пока нет записей</h2>
        <p>Здесь появятся сохранённые данные платформы.</p>
      </div>
    );
  return (
    <div className="table-scroll" tabIndex={0} aria-label={caption ?? kind}>
      <table>
        <caption className="sr-only">{caption ?? kind}</caption>
        <thead>
          <tr>
            {columns[kind].map((k) => (
              <th key={k} scope="col">
                {labels[k]}
              </th>
            ))}
            {kind === "qa" && <th scope="col">Замечания</th>}
            {kind === "versions" && <th scope="col">Проверка качества</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns[kind].map((key, i) => (
                <td
                  key={key}
                  className={
                    key.endsWith("_id") || key === "id" ? "identifier" : ""
                  }
                >
                  {i === 0 && rowLink(kind, row) ? (
                    <Link to={rowLink(kind, row)!}>
                      {display(row[key], key)}
                    </Link>
                  ) : key === "project_id" && typeof row[key] === "string" ? (
                    <Link
                      to={`/admin/projects/${encodeURIComponent(row[key])}`}
                    >
                      {row[key]}
                    </Link>
                  ) : (
                    display(row[key], key)
                  )}
                </td>
              ))}
              {kind === "qa" && (
                <td>
                  <QAInfo row={row} />
                </td>
              )}
              {kind === "versions" && (
                <td>
                  {row.workflow_run_id ? (
                    <Link
                      to={`/admin/qa?workflowId=${encodeURIComponent(row.workflow_run_id)}`}
                    >
                      QA этой версии →
                    </Link>
                  ) : (
                    "Недоступно"
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function QAInfo({ row }: { row: AdminRow }) {
  const issues = row.issues ?? [];
  return (
    <details>
      <summary>{issues.length} замечаний</summary>
      <div className="qa-issues">
        {row.website_version_id && <p>Версия: {row.website_version_id}</p>}
        {row.workflow_run_id && (
          <Link
            to={`/admin/workflows/${encodeURIComponent(row.workflow_run_id)}`}
          >
            Исходный workflow →
          </Link>
        )}
        <p>
          {(["critical", "error", "warning", "info"] as const)
            .map(
              (s) => `${s}: ${issues.filter((i) => i.severity === s).length}`,
            )
            .join(" · ")}
        </p>
        {issues.map((issue, i) => (
          <article key={i}>
            <Badge value={issue.severity} />
            <strong>{issue.code}</strong>
            <p>{issue.message}</p>
            {issue.recommendation && (
              <p>Рекомендация: {issue.recommendation}</p>
            )}
          </article>
        ))}
      </div>
    </details>
  );
}
export function Metadata({ row }: { row: AdminRow }) {
  return (
    <dl className="metadata">
      {Object.entries(row)
        .filter(([key]) => Object.hasOwn(labels, key))
        .map(([key, value]) => (
          <div key={key}>
            <dt>{labels[key] ?? key}</dt>
            <dd>{display(value, key)}</dd>
          </div>
        ))}
    </dl>
  );
}
