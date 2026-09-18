import {FakeProvider} from '../../.test-build/packages/ai/src/providers/fake-provider.js';
import {AIProviderError} from '../../.test-build/packages/ai/src/providers/errors.js';
import {readRouterPolicy} from '../../.test-build/packages/ai/src/router/policy.js';
import {OwnerGenerationPolicy} from '../../.test-build/packages/security/src/authorization.js';
import {LocalSecretProvider} from '../../.test-build/packages/security/src/secrets.js';
import {createRoutedBusinessService} from '../../.test-build/packages/ai/src/services/routed-business-service.js';
import {createWebsiteWorkflowService} from '../../.test-build/packages/ai/src/services/website-workflow-service.js';
import {validOutputs} from './website.mjs';
import {businessWire} from './business-wire.mjs';
import {qaWire} from './qa.mjs';
export function launchBrief(){return {companyName:'Example',description:'Custom glass partitions',productsOrServices:'Partitions',targetAudience:'Homeowners',geography:null,websiteGoals:'Receive enquiries',advantages:null,desiredActions:'Request a quote',contacts:null,notes:null};}
export function fakeLaunchFactory({fail,qaPass=true,hold,primary='openai',transient=false,invalidDesign=false,invalidContent=false,contentText,inspectRequest}={}){
 const calls=[];
 const factory=async(scope,runId,costs)=>{
  const context={...scope,workflowId:runId,actor:{id:scope.actorId,authenticated:true}};
  const providers=['openai','yandex'].map(id=>({id,credentials:{id,provider:id,projectId:scope.projectId,organizationId:scope.organizationId,secretRef:`test/${id}`},config:{model:id==='openai'?'test-model':'gpt://test-folder/yandexgpt/latest',folderId:'test-folder',timeoutMs:100,maxOutputTokens:1000},
   testAdapter:new FakeProvider(async req=>{
    const stage={business_profile:'business',design_direction:'design',content_plan:'content',developer_layout:'developer',qa_report:'qa'}[req.structuredOutput?.name];calls.push({stage,provider:id});inspectRequest?.(stage,req);
    await hold?.(stage,req.signal);
    if(stage===fail)throw new Error('RAW_PROVIDER_BODY_MUST_NEVER_LEAK');
    if(transient&&stage==='business'&&id===primary)throw new AIProviderError('NETWORK');
    const v=validOutputs();const structured={business:businessWire(),design:v.design,content:v.content,developer:{sections:[{sectionIndex:0,alignment:'left'}]},qa:qaWire(qaPass)}[stage];
    if(stage==='content'&&contentText)structured.sections[0].text=contentText;
    return {model:req.model,content:'{}',structured:(stage==='design'&&invalidDesign)||(stage==='content'&&invalidContent)?{}:structured,usageRecord:{provider:id,model:req.model,timestamp:new Date().toISOString(),inputTokens:10,outputTokens:20,totalTokens:30,durationMs:1,requestId:'fixture-request'}};
   })}));
  const options={context,costs,providers,policy:readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:primary,KLEO_AI_FALLBACK_PROVIDER:primary==='openai'?'yandex':'openai'}),authorization:new OwnerGenerationPolicy(scope.actorId,scope),secrets:new LocalSecretProvider(providers.map(p=>({...p.credentials,value:'TEST_ONLY_LAUNCH_CREDENTIAL'})),'test')};
  return createWebsiteWorkflowService(options,{business:await createRoutedBusinessService(options)});
 };
 return {factory,calls};
}
