import {test,expect} from '@playwright/test';
import {launchBrief} from '../../../tests/fixtures/launch.mjs';
test('real browser launches exactly one fake routed workflow, refreshes and finds persisted results',async({page,context})=>{
 const external=[];await context.route('**/*',route=>{if(!['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)){external.push('blocked');return route.abort();}return route.continue();});
 await page.goto('/login');await page.getByLabel('Электронная почта',{exact:true}).fill('owner@example.test');await page.getByLabel('Пароль',{exact:true}).fill('TEST_ONLY_Local_Console_42');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:'Обзор платформы'})).toBeVisible();
 const projectId=await page.evaluate(async brief=>{
  const base='http://localhost:3001/api/v1',me=await(await fetch(`${base}/auth/me`,{credentials:'include'})).json();
  const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-csrf-token':me.csrfToken},body:JSON.stringify(body)});if(!r.ok)throw Error('Fixture setup failed');return r.json();};
  const org=await post('/admin/organizations',{name:'Workflow fixture',operationId:crypto.randomUUID()});const project=await post(`/admin/organizations/${org.id}/projects`,{name:'Контрольный запуск',operationId:crypto.randomUUID()});
  await post(`/admin/projects/${project.id}/brief`,{organizationId:org.id,operationId:crypto.randomUUID(),expectedVersion:0,brief});return project.id;
 },launchBrief());
 await page.goto(`/admin/projects/${projectId}`);const region=page.getByRole('region',{name:'Создание сайта',exact:true});
 await region.getByRole('button',{name:'Запустить создание сайта',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Версия брифа: 1');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).not.toBeVisible();
 await region.getByRole('button',{name:'Запустить создание сайта',exact:true}).click();await dialog.getByRole('button',{name:'Запустить',exact:true}).click();
 // A persisted run can be discovered independently while the POST awaits completion.
 await expect.poll(async()=>page.evaluate(async id=>(await(await fetch(`http://localhost:3001/api/v1/admin/projects/${id}/workflow-state`,{credentials:'include'})).json()).run?.id,projectId)).toBeTruthy();
 await page.reload();await expect(region).toContainText('Создание сайта выполняется');const runLink=region.getByRole('link',{name:'Открыть процесс',exact:true});const href=await runLink.getAttribute('href');
 await expect(region.getByRole('button',{name:'Запустить создание сайта',exact:true})).toBeDisabled();
 await expect(region).toContainText('Создание сайта завершено',{timeout:15000});await expect(runLink).toHaveAttribute('href',href);await expect(region).toContainText('5 из 5 этапов завершены');await expect(region.getByRole('link',{name:'Открыть версию сайта'})).toBeVisible();await expect(region.getByRole('link',{name:'Открыть QA',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/kleo-console-workflow-launch.png',fullPage:true});await runLink.click();await expect(page.getByRole('region',{name:'Создание сайта',exact:true})).toContainText('Версия брифа: 1');
 await page.getByRole('link',{name:'Использование ИИ →',exact:true}).click();await expect(page.getByRole('table')).toContainText('test-model');expect(external).toEqual([]);await expect(page.getByRole('button',{name:/Preview|Предпросмотр/})).toHaveCount(0);
});
