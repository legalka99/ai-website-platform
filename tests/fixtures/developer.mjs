import { FakeProvider } from '../../.test-build/packages/ai/src/providers/fake-provider.js';
import { readRouterPolicy } from '../../.test-build/packages/ai/src/router/policy.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard } from '../../.test-build/packages/security/src/index.js';
import { validOutputs } from './website.mjs';
export const developerInput=()=>{const v=validOutputs();return {business:v.business,design:v.design,content:v.content};};
export const developerContext=()=>({projectId:'project-1',goal:'Build a draft website',input:developerInput()});
export const layout=(count=1)=>({sections:Array.from({length:count},(_,sectionIndex)=>({sectionIndex,alignment:'left'}))});
export function developerOptions(primary='openai',failure,proposal=layout()) {
  const context={projectId:'project-1',organizationId:'org-1',workflowId:'developer-run',actor:{id:'owner',authenticated:true}};
  const counts={openai:0,yandex:0},requests=[];
  const providers=['openai','yandex'].map(id=>({id,credentials:{id:`cred-${id}`,provider:id,projectId:context.projectId,organizationId:context.organizationId,secretRef:`local/${id}`},
    config:{model:id==='openai'?'test-model':'gpt://test-folder/yandexgpt/latest',folderId:'test-folder',timeoutMs:100,maxOutputTokens:1000},testAdapter:new FakeProvider(req=>{
      counts[id]++;requests.push(req);if(id===primary&&failure)throw failure;
      return {model:req.model,structured:proposal,content:'{}',usageRecord:{provider:id,model:req.model,timestamp:'2026-09-16T00:00:00.000Z',durationMs:1,inputTokens:10,outputTokens:20,totalTokens:30,cachedInputTokens:3,requestId:'safe-request'}};
    })}));
  return {counts,requests,context,providers,authorization:new AuthorizationPolicy([{...context,actorId:'owner',role:'owner'}]),costs:new AICostGuard(),
    secrets:new LocalSecretProvider(providers.map(p=>({...p.credentials,value:'TEST_ONLY_DEVELOPER_KEY'})),'test'),
    policy:readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:primary,KLEO_AI_FALLBACK_PROVIDER:primary==='openai'?'yandex':'openai'})};
}
