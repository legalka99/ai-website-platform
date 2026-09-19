import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BRIEF_ADVANTAGES_MAX_ITEMS, BRIEF_ADVANTAGE_MAX_LENGTH, BRIEF_ADVANTAGES_MAX_TOTAL_LENGTH, briefFields, type BriefAdvantages, type BusinessBrief, type BriefView } from "../../../packages/core/src/business-brief.js";
import type { AdminDetail } from "../../../packages/core/src/admin-api.js";
import { api, ApiError } from "./api.js";
import { Header, ErrorState, Loading, useRemote } from "./components.js";

function useWrite() {
  const locked = useRef(false), attempt = useRef({ payload: "", key: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function submit(path: string, body: Record<string, unknown>, message: string, done: (result: any) => void) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const payload = JSON.stringify([path, body]);
    if (attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try { done(await api.request(path, undefined, { ...body, operationId: attempt.current.key })); }
    catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "Данные изменились или запрос уже использован. Обновите страницу и проверьте сохранённый результат перед повторной отправкой." : message + " Проверьте поля: без HTML, паролей и ключей доступа. При неизвестном результате повторите ту же отправку без изменения полей.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { locked.current = false; setBusy(false); }
  }
  return { busy, error, errorRef, submit };
}
function Denied() { return <Header title="Доступ запрещён" description="Создание и изменение доступны только владельцу платформы." />; }
const advantageValues=(value:BriefAdvantages):string[]=>Array.isArray(value)?value.map(item=>item.text):typeof value==='string'?[value]:[];
const briefHints:Record<keyof typeof briefFields,string>={
  companyName:"Укажите название компании, бренда или проекта.",
  description:"Опишите бизнес простыми словами: что вы делаете, продаёте или какие услуги оказываете. Можно писать свободно.",
  productsOrServices:"Перечислите основные товары и услуги. Можно написать списком, каждый пункт с новой строки.",
  targetAudience:"Кто ваши основные клиенты? Например: частные лица, дизайнеры, застройщики, компании.",
  geography:"Укажите города, регионы или страны, где вы работаете.",
  websiteGoals:"Что должен сделать посетитель сайта: оставить заявку, позвонить, купить, записаться, запросить расчёт и т. д.",
  advantages:"Напишите преимущества бизнеса, каждое с новой строки. Можно писать своими словами и с опечатками — AiVeron постарается понять и исправить их.",
  desiredActions:"Например: Получить расчёт, Оставить заявку, Заказать звонок.",
  contacts:"Укажите только те контакты, которые можно показать посетителям сайта.",
  notes:"Добавьте пожелания к сайту свободным текстом.",
};
export function CreateResource({ owner, project = false }: { owner: boolean; project?: boolean }) {
  const { organizationId } = useParams();
  if (!owner) return <Denied />;
  return <NameForm key={organizationId ?? "organization"} organizationId={project ? organizationId : undefined} />;
}
function NameForm({ organizationId }: { organizationId?: string }) {
  const navigate = useNavigate(), write = useWrite(), project = Boolean(organizationId);
  const title = project ? "Создать проект" : "Создать организацию";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    await write.submit(project ? `/api/v1/admin/organizations/${encodeURIComponent(organizationId!)}/projects` : "/api/v1/admin/organizations", { name: String(data.get("name") ?? "").trim() }, project ? "Не удалось создать проект." : "Не удалось создать организацию.", r => navigate(`/admin/${project ? "projects" : "organizations"}/${encodeURIComponent(r.id)}`));
  }
  return <>
    <Link className="back" to={project ? `/admin/organizations/${organizationId}` : "/admin/organizations"}>← Назад</Link>
    <Header title={title} description="Данные сохранятся в платформе. Генерация сайта не запускается." />
    <form className="panel owner-form" onSubmit={e => void submit(e)}>
      <fieldset disabled={write.busy}><legend>Основные сведения</legend>
        <label htmlFor="resource-name">{project ? "Название проекта" : "Название организации"}</label>
        <input id="resource-name" name="name" required maxLength={200} aria-describedby={write.error ? "write-error" : undefined} />
        {project && <p>Проект будет создан внутри выбранной организации.</p>}
        {write.error && <p id="write-error" ref={write.errorRef} tabIndex={-1} role="alert" className="form-error">{write.error}</p>}
        <button className="primary" type="submit">{write.busy ? "Сохранение…" : title}</button>
      </fieldset>
    </form>
  </>;
}
export function BriefSummary({ projectId, owner }: { projectId: string; owner: boolean }) {
  const r = useRemote<BriefView>(`/api/v1/admin/projects/${encodeURIComponent(projectId)}/brief`);
  return <section className="panel" aria-label="Бизнес-бриф">
    <div className="panel-title"><h2>Бизнес-бриф</h2>{owner && r.data && <Link to={`/admin/projects/${projectId}/brief`}>{r.data.snapshot ? "Редактировать бриф" : "Заполнить бриф"}</Link>}</div>
    {r.error ? <ErrorState error={r.error} retry={r.retry} /> : !r.data ? <Loading /> : r.data.snapshot ? <>
      <p className="finance-note">Заполнен · Версия {r.data.snapshot.version}</p>
      <dl className="metadata">{Object.entries(briefFields).map(([key, field]) => {
        const value=r.data!.snapshot!.brief[key as keyof BusinessBrief];
        return <div key={key}><dt>{field.label}</dt><dd>{key==='advantages'?(advantageValues(value as BriefAdvantages).length?<ul>{advantageValues(value as BriefAdvantages).map((item,index)=><li key={index}>{item}</li>)}</ul>:"Не указано"):((value as string|null)??"Не указано")}</dd></div>;
      })}</dl>
    </> : <p className="state">Не заполнен</p>}
  </section>;
}
export function BriefPage({ owner }: { owner: boolean }) {
  const { projectId = "" } = useParams();
  if (!owner) return <Denied />;
  return <BriefLoader key={projectId} projectId={projectId} />;
}
function BriefLoader({ projectId }: { projectId: string }) {
  const r = useRemote<BriefView>(`/api/v1/admin/projects/${encodeURIComponent(projectId)}/brief`);
  const project = useRemote<AdminDetail>(`/api/v1/admin/projects/${encodeURIComponent(projectId)}`);
  if (r.error || project.error) return <ErrorState error={(r.error ?? project.error)!} retry={() => { r.retry(); project.retry(); }} />;
  if (!r.data || !project.data) return <Loading />;
  return <BriefForm projectId={projectId} organizationId={project.data.item.organization_id!} view={r.data} />;
}
function BriefForm({ projectId, organizationId, view }: { projectId: string; organizationId: string; view: BriefView }) {
  const write = useWrite(), navigate = useNavigate();
  const [advantages,setAdvantages]=useState(()=>advantageValues(view.snapshot?.brief.advantages??null).join('\n'));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const brief = Object.fromEntries(Object.keys(briefFields).map(key => [key,key==='advantages'?String(data.get(key)??'').replace(/\r\n?/g,'\n').split('\n').map(value=>value.trim()).filter(Boolean).map(text=>({text})):String(data.get(key) ?? "").trim() || null]));
    await write.submit(`/api/v1/admin/projects/${encodeURIComponent(projectId)}/brief`, { organizationId, expectedVersion: view.snapshot?.version ?? 0, brief }, "Не удалось сохранить бриф.", () => navigate(`/admin/projects/${projectId}?briefSaved=1`));
  }
  return <>
    <Link className="back" to={`/admin/projects/${projectId}`}>← К проекту</Link>
    <Header title="Бизнес-бриф" description="Исходное задание для будущей генерации. Укажите подтверждённые сведения; не добавляйте пароли, ключи доступа и банковские данные." />
    <form className="panel owner-form" onSubmit={e => void submit(e)}>
      <fieldset disabled={write.busy}><legend>Сведения о бизнесе</legend>
        {Object.entries(briefFields).filter(([key])=>key!=='advantages').map(([key, field]) => <div className="brief-field" key={key}>
          <label htmlFor={`brief-${key}`}>{field.label}{field.required ? " *" : ""}</label>
          <textarea id={`brief-${key}`} name={key} rows={key === "companyName" ? 1 : 3} required={field.required} maxLength={field.max} defaultValue={(view.snapshot?.brief[key as keyof BusinessBrief] as string|null) ?? ""} placeholder={briefHints[key as keyof typeof briefFields]} aria-describedby={write.error ? "write-error" : `brief-${key}-help`} />
          <p id={`brief-${key}-help`}>{briefHints[key as keyof typeof briefFields]}</p>
        </div>)}
        <div className="brief-field">
          <label htmlFor="brief-advantages">Ключевые преимущества</label>
          <textarea id="brief-advantages" name="advantages" rows={7} maxLength={BRIEF_ADVANTAGES_MAX_TOTAL_LENGTH+BRIEF_ADVANTAGES_MAX_ITEMS-1} value={advantages} onChange={event=>setAdvantages(event.target.value)} placeholder={'Собственное производство\nКачественная фурнитура\nПрозрачные цены'} aria-describedby={write.error ? "write-error" : "brief-advantages-help"} />
          <p id="brief-advantages-help">{briefHints.advantages} До {BRIEF_ADVANTAGES_MAX_ITEMS} пунктов, не более {BRIEF_ADVANTAGE_MAX_LENGTH} символов каждый.</p>
        </div>
        <p id="brief-help">* Обязательное поле. Контакты сохраняются как текст, ссылки не открываются автоматически. Сохранение создаёт новую версию задания.</p>
        {write.error && <p id="write-error" ref={write.errorRef} tabIndex={-1} role="alert" className="form-error">{write.error}</p>}
        <button type="submit" className="primary">{write.busy ? "Сохранение…" : "Сохранить бриф"}</button>
      </fieldset>
    </form>
  </>;
}
