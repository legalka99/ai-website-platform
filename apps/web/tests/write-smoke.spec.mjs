import { test, expect } from '@playwright/test';
test('real owner creates organization/project, saves brief, refreshes and tenant cannot write', async ({page,context})=>{
 const external=[];
 await context.route('**/*',async route=>{if(!['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.setViewportSize({width:1440,height:900});await page.goto('/login');
 async function login(email){await page.getByLabel('Электронная почта',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill('TEST_ONLY_Local_Console_42');await page.getByRole('button',{name:'Войти',exact:true}).click();}
 await login('owner@example.test');await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('link',{name:'Организации',exact:true}).click();
 await page.getByRole('link',{name:'Создать организацию',exact:true}).click();
 await page.getByLabel('Название организации',{exact:true}).fill('Тестовый клиент — создание');
 await page.getByRole('button',{name:'Создать организацию',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Тестовый клиент — создание',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Создать проект',exact:true}).click();await page.getByLabel('Название проекта',{exact:true}).fill('Тестовый сайт');
 await page.getByRole('button',{name:'Создать проект',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Тестовый сайт',exact:true})).toBeVisible();
 const projectId=new URL(page.url()).pathname.split('/').at(-1);
 await page.getByRole('link',{name:'Заполнить бриф',exact:true}).click();
 const values={companyName:'Мебельная студия',description:'Проектирование мебели',productsOrServices:'Столы и шкафы',targetAudience:'Небольшие компании',websiteGoals:'Получить заявки',desiredActions:'Оставить заявку',contacts:'hello@example.test',notes:'Только подтверждённые сведения'};
 for(const [key,value] of Object.entries(values))await page.locator(`[name="${key}"]`).fill(value);
 await page.getByRole('button',{name:'Сохранить бриф',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Бриф сохранён'})).toBeVisible();
 await page.reload();await expect(page.getByRole('region',{name:'Бизнес-бриф',exact:true})).toContainText('Мебельная студия');
 await expect(page.getByRole('region',{name:'Бизнес-бриф',exact:true})).toContainText('Версия 1');
 await page.screenshot({path:'/tmp/kleo-console-write-brief.png',fullPage:true});
 await page.getByRole('link',{name:'Редактировать бриф',exact:true}).click();await expect(page.locator('[name="companyName"]')).toHaveValue('Мебельная студия');
 await page.locator('[name="notes"]').fill('Уточнение задания');await page.getByRole('button',{name:'Сохранить бриф',exact:true}).click();await expect(page.getByRole('region',{name:'Бизнес-бриф',exact:true})).toContainText('Версия 2');
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('tenant@example.test');await expect(page.getByRole('heading',{name:'Доступ запрещён'})).toBeVisible();
 const statuses=await page.evaluate(async projectId=>{
  const me=await (await fetch('http://localhost:3001/api/v1/auth/me',{credentials:'include'})).json();
  const headers={'content-type':'application/json','x-csrf-token':me.csrfToken};
  const r=await fetch('http://localhost:3001/api/v1/admin/organizations',{method:'POST',credentials:'include',headers,body:JSON.stringify({operationId:crypto.randomUUID(),name:'Not allowed'})});
  const read=await fetch(`http://localhost:3001/api/v1/admin/projects/${projectId}/brief`,{credentials:'include'});return [r.status,read.status];
 },projectId);
 expect(statuses).toEqual([403,403]);expect(external).toEqual([]);
});
