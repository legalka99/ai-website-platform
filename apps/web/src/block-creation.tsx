import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {BLOCK_TYPES,type BlockCreationView} from '../../../packages/core/src/block-generation.js';
import type {Clarification} from '../../../packages/core/src/understanding.js';
const names={hero:'Первый экран',advantages:'Преимущества',services:'Услуги',process:'Этапы',faq:'FAQ',cta:'Призыв к действию',text:'Текст'};
const stages={starting:'Запуск',design:'Дизайн',content:'Тексты',developer:'Сборка блока',qa:'Проверка качества'};
export function BlockCreation({projectId,owner,active}:{projectId:string;owner:boolean;active:boolean}){
 const [view,setView]=useState<BlockCreationView|null>(null),[pageId,setPageId]=useState(''),[instruction,setInstruction]=useState(''),[kind,setKind]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[clarification,setClarification]=useState<Clarification|null>(null),[tick,refresh]=useState(0);
 const locked=useRef(false),attempt=useRef({payload:'',key:''}),path=`/api/v1/admin/projects/${encodeURIComponent(projectId)}`;
 useEffect(()=>{const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
 async function read(){try{const v=await api.request<BlockCreationView>(path+'/block-workflows',c.signal);if(c.signal.aborted)return;setView(v);setPageId(p=>v.pages.some(x=>x.id===p)?p:v.pages[0]?.id??'');if(locked.current||v.run?.status==='running'&&Date.now()<Date.parse(v.run.deadlineAt))timer=setTimeout(read,3000);}catch{if(!c.signal.aborted)setError('Не удалось получить статус блока. Обновите статус перед новым запуском.');}}
 void read();return()=>{c.abort();clearTimeout(timer);};},[path,tick]);
 async function submit(initialize=false){if(locked.current)return;locked.current=true;setBusy(true);setError('');setClarification(null);refresh(x=>x+1);
 const body=initialize?{}:{pageId,instruction,...(kind?{blockType:kind}:{})};const payload=JSON.stringify(body);
 if(attempt.current.payload!==payload)attempt.current={payload,key:crypto.randomUUID()};
 try{const result=await api.request<{status?:string;clarification?:Clarification}>(path+(initialize?'/block-pages':'/block-workflows'),undefined,{...body,idempotencyKey:attempt.current.key});if(result.status==='needs_clarification'&&result.clarification)setClarification(result.clarification);attempt.current={payload:'',key:''};}
 catch{setError('Запрос не завершён. Проверьте сохранённый статус перед повтором.');}
 finally{locked.current=false;setBusy(false);refresh(x=>x+1);}
 }
 const run=view?.run,can=owner&&active&&view?.available&&!busy&&run?.status!=='running'&&!error;
 return <section className="panel" aria-label="Создание"><div className="panel-title"><h2>Создание</h2></div><div className="owner-form">
  <div role="group" aria-label="Режим создания"><button aria-pressed="true">Отдельный блок</button>{' '}<button disabled>Целая страница — Скоро</button>{' '}<button disabled>Сайт полностью — Скоро</button></div>
  {!view?<p>Загрузка…</p>:<>
   {!view.available&&<p>Генерация не настроена на сервере.</p>}
   {owner&&active&&<>
    {!view.pages.length?<><p>Подготовьте страницу: будет использован существующий сайт или создана пустая «Главная». Бриф необязателен.</p><button disabled={busy} onClick={()=>void submit(true)}>Подготовить страницу</button></>:<>
     <label>Страница<select value={pageId} disabled={busy} onChange={e=>setPageId(e.target.value)}>{view.pages.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
     <label>Что нужно сделать?<textarea maxLength={2000} value={instruction} disabled={busy} placeholder="Сделай блок преимуществ" onChange={e=>setInstruction(e.target.value)} /></label>
     <label>Тип блока (необязательно)<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="">Автоматически</option>{BLOCK_TYPES.map(t=><option key={t} value={t}>{names[t]}</option>)}</select></label>
     <p>Будет создан черновик одного блока. Запуск использует AI; неподтверждённые обещания запрещены.</p>
     <button className="primary" disabled={!can||!instruction.trim()||!pageId} onClick={()=>void submit()}>{busy?'Запуск…':'Создать блок'}</button>
    </>}
   </>}
   {run&&<div aria-live="polite"><p>{run.status==='completed'?'Блок создан':run.status==='failed'?'Создание блока остановлено':stages[run.stage]}</p>
    {run.errorCode&&<p>Код: {run.errorCode}</p>}
    {run.versionId&&<p>Сохранена версия черновика блока. Публикация не выполнялась.</p>}
    {run.status==='running'&&Date.now()>Date.parse(run.deadlineAt)&&<p>Процесс прерван или превысил время. Требуется проверка сервера; автоматический повтор отключён.</p>}
   </div>}
  </>}
  {clarification&&<div className="state" role="status"><p>{clarification.question}</p>{clarification.choices?.length?<ul>{clarification.choices.map(choice=><li key={choice.id}>{choice.label}</li>)}</ul>:null}</div>}
  {error&&<p role="alert">{error}</p>}<button onClick={()=>{setError('');setClarification(null);refresh(x=>x+1);}}>Обновить статус блока</button>
 </div></section>;
}
