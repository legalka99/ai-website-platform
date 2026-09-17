import { Link, useSearchParams } from "react-router";
import type { AdminList } from "../../../packages/core/src/admin-api.js";
import { DataTable, ErrorState, Header, Loading, useRemote } from "./components.js";
import { numberLabel } from "./labels.js";

/** No monetary DTO exists yet. Unknown accounting must never be represented as zero. */
export function FinanceOverview({ linked = false }: { linked?: boolean }) {
  return <section className="finance-summary" aria-label="Финансовые показатели">
    <div className="panel-title"><h2>{linked ? "Финансы" : "Обзор финансов"}</h2>{linked && <Link to="/admin/finance">Подробнее →</Link>}</div>
    <div className="metrics">
      {["Доход", "Расходы", "Прибыль", "Маржинальность"].map(label => <div className="metric" key={label}><span>{label}</span><strong>Недоступно</strong></div>)}
    </div>
    <p>Финансовый учёт ещё не подключён. Денежные показатели появятся после подключения учёта стоимости и выручки.</p>
  </section>;
}
const views = { usage: "Использование ИИ", organizations: "По организациям", projects: "По проектам" } as const;
export function Finance() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view") ?? "usage";
  const view: keyof typeof views = requested === "organizations" || requested === "projects" ? requested : "usage";
  const rawOffset = params.get("offset") ?? "0";
  const offset = /^(?:0|[1-9][0-9]{0,3}|10000)$/.test(rawOffset) ? Number(rawOffset) : 0;
  // Fixed existing admin resources. Never forward arbitrary search params or fetch every page for a total.
  const r = useRemote<AdminList>(`/api/v1/admin/${view}?limit=20&offset=${offset}`);
  const change = (next: number) => setParams({ view, offset: String(next) });
  return <>
    <Header title="Финансы" description="Финансовые показатели и данные для будущего расчёта себестоимости. Только просмотр." />
    <FinanceOverview />
    <nav className="finance-tabs" aria-label="Разделы финансов">
      {Object.entries(views).map(([key, label]) => <Link key={key} to={`/admin/finance?view=${key}`} aria-current={key === view ? "page" : undefined}>{label}</Link>)}
    </nav>
    <section className="panel" aria-label={views[view]}>
      <div className="panel-title"><h2>{views[view]}</h2><span>До 20 записей на странице</span></div>
      <p className="finance-note">{view === "usage"
        ? "Сохранённые попытки обращений к провайдерам, включая резервные. Токены — не денежная стоимость. Это отдельные записи, а не итог по всей платформе. Кэшированные токены входят во входные и не прибавляются повторно."
        : "Денежные показатели недоступны. Откройте организацию или проект, чтобы перейти к связанным данным и использованию ИИ."}</p>
      {r.error ? <ErrorState error={r.error} retry={r.retry} /> : !r.data ? <Loading /> : <>
        <DataTable kind={view} rows={r.data.data} finance />
        <div className="pagination"><span>Страница {numberLabel(Math.floor(offset / 20) + 1)} · {numberLabel(r.data.data.length)} записей</span><div>
          <button disabled={offset === 0} onClick={() => change(Math.max(0, offset - 20))}>Назад</button>
          <button disabled={r.data.data.length < 20 || offset + 20 > 10000} onClick={() => change(offset + 20)}>Далее</button>
        </div></div>
      </>}
    </section>
  </>;
}
