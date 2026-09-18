import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {api,ApiError} from './api.js';
import type {BriefView} from '../../../packages/core/src/business-brief.js';
import type {LaunchStateView} from '../../../packages/core/src/workflow-launch.js';
const labels={running:'Создание сайта выполняется',completed:'Создание сайта завершено',failed:'Процесс завершился с ошибкой',cancelled:'Процесс отменён',qa_failed:'QA не пройден'};
const stages={business:'Business',design:'Design',content:'Content',developer:'Developer',qa:'QA'};
const status={waiting:'Ожидает',running:'Выполняется',completed:'Завершён',failed:'Ошибка',cancelled:'Отменён'};
export function WorkflowLaunch({projectId,name,active,owner,workflowId}:{projectId:string;name:string;active:boolean;owner:boolean;workflowId?:string}){
 const [view,setView]=useState<LaunchStateView|null>(null),[brief,setBrief]=useState<BriefView|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),errorRef=useRef<HTMLParagraphElement>(null),locked=useRef(false),pending=useRef(false),attempt=useRef({version:'',key:''});
 const path=`/api/v1/admin/projects/${encodeURIComponent(projectId)}`;
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  async function read(){try{const data=await api.request<LaunchStateView>(`${path}/workflow-state${workflowId?`?workflowId=${encodeURIComponent(workflowId)}`:''}`,controller.signal);if(controller.signal.aborted)return;setView(data);setLoadError('');if((data.run?.status==='running'&&Date.now()<Date.parse(data.run.deadlineAt))||pending.current)timer=setTimeout(read,5000);}
   catch{if(!controller.signal.aborted){setLoadError('Не удалось получить статус. Проверьте сохранённый процесс перед новым запуском.');}}}
  void read();return()=>{controller.abort();clearTimeout(timer);};
 },[path,workflowId,refresh]);
 useEffect(()=>{if(workflowId||!owner)return;const c=new AbortController();void api.request<BriefView>(`${path}/brief`,c.signal).then(data=>{if(!c.signal.aborted)setBrief(data);}).catch(()=>{});return()=>c.abort();},[path,workflowId,owner,refresh]);
 async function launch(){if(locked.current||!brief?.snapshot)return;locked.current=true;pending.current=true;setBusy(true);setError('');setRefresh(v=>v+1);
  const version=brief.snapshot.id;if(attempt.current.version!==version)attempt.current={version,key:crypto.randomUUID()};
  try{await api.request(`${path}/workflows`,undefined,{briefVersionId:version,idempotencyKey:attempt.current.key});attempt.current={version:'',key:''};}
  catch(e){setError(e instanceof ApiError&&e.status===409?'Для проекта уже выполняется процесс или запрос конфликтует. Проверьте сохранённый статус.':'Не удалось запустить процесс. Результат запроса мог сохраниться; проверьте статус перед повторной отправкой.');requestAnimationFrame(()=>errorRef.current?.focus());}
  finally{dialog.current?.close();pending.current=false;locked.current=false;setBusy(false);setRefresh(v=>v+1);}
 }
 const run=view?.run;const canLaunch=owner&&!workflowId&&active&&view?.available&&brief?.snapshot&&run?.status!=='running'&&!busy&&!error&&!loadError;
 return <section className="panel workflow-launch" aria-label="Создание сайта">
  <div className="panel-title"><h2>Создание сайта</h2></div>
  <div className="owner-form">
   <p role="status">{run?labels[run.status]:view?'Процесс ещё не запускался.':'Загрузка статуса…'}</p>
   {(error||loadError)&&<p role="alert" tabIndex={-1} ref={errorRef}>{error||loadError}</p>}
   {(error||loadError)&&<button onClick={()=>{setError('');setRefresh(v=>v+1);}}>Проверить статус</button>}
   {run&&<>
    <p>Версия брифа: {run.briefVersion} · <Link to={`/admin/workflows/${run.id}`}>Открыть процесс</Link></p>
    <p>Начало: {new Date(run.startedAt).toLocaleString('ru-RU')}{run.completedAt?` · Завершение: ${new Date(run.completedAt).toLocaleString('ru-RU')} · Длительность: ${Math.max(0,Math.round((Date.parse(run.completedAt)-Date.parse(run.startedAt))/1000))} с`:''}</p>
    {run.failureCode&&<p>{run.failureCode==='BUDGET_EXCEEDED'?'Превышен лимит выполнения.':run.failureCode==='TIMEOUT'?'Превышено время выполнения.':'Процесс остановлен.'} Код: {run.failureCode}</p>}
    {run.status==='running'&&Date.now()>Date.parse(run.deadlineAt)&&<p>Процесс не завершён в установленное время. Требуется проверка сервера; автоматический повтор отключён.</p>}
    <ol className="timeline">{run.stages.map(s=><li key={s.stage}><strong>{stages[s.stage]}</strong><span>{status[s.status]}</span></li>)}</ol>
    <p>{run.stages.filter(s=>s.status==='completed').length} из 5 этапов завершены</p>
    <div className="workflow-result-links">{run.versionId&&<Link to={`/admin/versions?websiteId=${run.websiteId}`}>Открыть версию сайта</Link>}{' '}
    {run.qaId&&<Link to={`/admin/qa?workflowId=${run.id}`}>Открыть QA</Link>}{' '}
    <Link to={`/admin/usage?workflowId=${run.id}`}>Использование ИИ</Link></div>
   </>}
   {owner&&!workflowId&&<>
    {!view?.available&&view&&<p>Запуск ИИ не настроен на сервере.</p>}
    {!brief?.snapshot&&<p>Для запуска сохраните бизнес-бриф.</p>}
    <button className="primary" disabled={!canLaunch} onClick={()=>dialog.current?.showModal()}>{busy?'Запуск…':'Запустить создание сайта'}</button>
    <dialog ref={dialog} aria-labelledby="launch-title" className="launch-dialog">
     <h2 id="launch-title">Запустить создание сайта?</h2><p>Проект: {name}</p><p>Версия брифа: {brief?.snapshot?.version}</p>
     <p>Будут использованы AI-модели. Лимит: до {view?.limits.maxWorkflowOutputTokens.toLocaleString('ru-RU')} зарезервированных выходных токенов и {view?.limits.maxRequestsPerWorkflow} запросов. Это не денежный лимит. Сайт останется черновиком.</p>
     <p>{busy?"Запуск выполняется. Закрытие этого окна не отменяет процесс.":""}</p>
     <button autoFocus onClick={()=>dialog.current?.close()}>{busy?"Закрыть окно":"Отмена"}</button>{' '}<button className="primary" disabled={!canLaunch} onClick={()=>void launch()}>{busy?"Запуск…":"Запустить"}</button>
    </dialog>
   </>}
  </div>
 </section>;
}
