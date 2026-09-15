import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorizationPolicy, ApprovalStore, ToolPolicy, DANGEROUS_ACTIONS, InMemoryRateLimiter, AICostGuard, DEFAULT_AI_LIMITS, validateUpload, DisabledSandboxRunner, httpSecurityDefaults } from '../.test-build/packages/security/src/index.js';
const resource = { projectId: 'p1', organizationId: 'o1' }; const actor = { id: 'owner', authenticated: true };
const auth = new AuthorizationPolicy([{ ...resource, actorId:'owner',role:'owner' },{ ...resource,actorId:'viewer',role:'viewer' },{ ...resource,actorId:'editor',role:'editor' }]);
test('owner allowed, viewer read only, editor cannot manage credentials', () => {
  assert.equal(auth.authorize(actor,'write',resource),true);
  assert.equal(auth.authorize({id:'viewer',authenticated:true},'read',resource),true);
  assert.equal(auth.authorize({id:'viewer',authenticated:true},'write',resource),false);
  assert.equal(auth.authorize({id:'editor',authenticated:true},'manage_credentials',resource),false);
});
test('cross-project/org, unauthenticated and unknown permissions denied', () => {
  for (const target of [{...resource,projectId:'p2'},{...resource,organizationId:'o2'}]) assert.equal(auth.authorize(actor,'read',target),false);
  assert.equal(auth.authorize({...actor,authenticated:false},'read',resource),false); assert.equal(auth.authorize(actor,'unknown',resource),false);
});
function toolContext() { return {...resource,actor,agentId:'business',planTools:['publish'],projectTools:['publish'],userAllowedTools:['publish'],payloadHash:'a'.repeat(64)}; }
function toolPolicy(approvals = new ApprovalStore()) { return { approvals, policy:new ToolPolicy([{name:'publish',permission:'publish',action:'publish'}],[{agentId:'business',tools:['publish']}],auth,approvals) }; }
test('unknown tools denied and dangerous tool requires approval', () => {
  const {policy}=toolPolicy(); assert.equal(policy.authorizeExecution('shell',toolContext()).reason,'UNKNOWN_TOOL'); assert.equal(policy.authorizeExecution('publish',toolContext()).reason,'APPROVAL_REQUIRED');
});
test('tool must be allowed for agent, plan, project, user and actor', () => {
  for (const patch of [{agentId:'other'},{planTools:[]},{projectTools:[]},{userAllowedTools:[]},{actor:{id:'viewer',authenticated:true}},{projectId:'p2'}]) assert.equal(toolPolicy().policy.authorizeExecution('publish',{...toolContext(),...patch}).reason,'DENIED');
});
test('approval requires preview and binds actor/project/tool/exact payload, then consumed once', () => {
  const {policy,approvals}=toolPolicy(); const ctx=toolContext(); const id=approvals.draft(ctx,'publish');
  assert.equal(approvals.approve(id,ctx,'publish'),false); assert.equal(approvals.preview(id,ctx,'publish'),true); assert.equal(approvals.approve(id,ctx,'publish'),true);
  const ready={...ctx,approvalId:id,previewId:id};
  assert.equal(policy.authorizeExecution('publish',{...ready,payloadHash:'b'.repeat(64)}).allowed,false);
  assert.equal(policy.authorizeExecution('publish',ready).allowed,true); assert.equal(policy.authorizeExecution('publish',ready).allowed,false);
});
test('expired approval cannot execute; all dangerous actions are enumerated', () => {
  let now=0; const {policy,approvals}=toolPolicy(new ApprovalStore(()=>now));const ctx=toolContext();const id=approvals.draft(ctx,'publish');approvals.preview(id,ctx,'publish');approvals.approve(id,ctx,'publish');now=300001;
  assert.equal(policy.authorizeExecution('publish',{...ctx,approvalId:id,previewId:id}).allowed,false); assert.equal(DANGEROUS_ACTIONS.length,7);
});
test('rate limiter permits under limit, denies over limit, isolates projects and expires', () => {
  let now=0;const rate=new InMemoryRateLimiter(()=>now);const key={dimension:'project',projectId:'p1',subject:'generation'};
  assert.equal(rate.consume(key,1,1000).allowed,true);assert.equal(rate.consume(key,1,1000).allowed,false);
  assert.equal(rate.consume({...key,projectId:'p2'},1,1000).allowed,true);now=1000;assert.equal(rate.consume(key,1,1000).allowed,true);
});
test('all rate dimensions supported and invalid limits rejected', () => {
  const rate=new InMemoryRateLimiter();for(const dimension of ['actor','ip','api_key','project','ai_operation']) assert.equal(rate.consume({dimension,projectId:'p',subject:'test-reference'},1,1000).allowed,true);
  assert.throws(()=>rate.consume({dimension:'project',projectId:'p',subject:'a'},0,1000));
});
test('AI guard enforces concurrency and releases exactly once; failures retain cost reservations', () => {
  const guard=new AICostGuard({...DEFAULT_AI_LIMITS,maxConcurrent:1,maxRequestsPerWorkflow:2});
  const first=guard.reserve('p1','w1',100);assert.throws(()=>guard.reserve('p2','w2',100));first.release();first.release();
  const second=guard.reserve('p1','w1',100);assert.equal(second.budget.requests,2);assert.equal(second.budget.reservedOutputTokens,200);second.release();assert.throws(()=>guard.reserve('p1','w1',100));
});
test('AI guard bounds output, workflow budget, RPM, and retries; projects isolate workflow ids', () => {
  const guard=new AICostGuard({...DEFAULT_AI_LIMITS,maxWorkflowOutputTokens:150,requestsPerMinute:1});
  assert.throws(()=>guard.reserve('p','w',9000));const r=guard.reserve('p','w',100);r.release();assert.throws(()=>guard.reserve('p','w',100));assert.throws(()=>guard.reserve('p','other',10));guard.reserve('p2','w',100).release();
  assert.throws(()=>new AICostGuard({...DEFAULT_AI_LIMITS,maxRetries:1}));
});
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0]);
for(const name of ['../../evil.png','%2e%2e%2fevil.png','%252e%252e%252fevil.png','/tmp/file.png','C:\\tmp\\evil.png','..\\evil.png','good.png%00.js','evil.svg','evil.php','evil.js']) test(`unsafe upload filename denied: ${name}`,()=>assert.throws(()=>validateUpload(name,'image/png',png)));
test('upload validates MIME/signature/size; names generated and quarantined outside web root',()=>{
  const a=validateUpload('photo.png','image/png',png),b=validateUpload('photo.png','image/png',png);assert.notEqual(a.storageName,b.storageName);assert.equal(a.storageArea,'quarantine-outside-web-root');assert.ok(!a.storageName.includes('photo'));
  assert.throws(()=>validateUpload('photo.png','text/html',png));assert.throws(()=>validateUpload('photo.png','image/png',Buffer.from('<script>')));assert.throws(()=>validateUpload('photo.png','image/png',png,2));
});
test('default sandbox never executes supplied code',async()=>{
  const result=await new DisabledSandboxRunner().run({projectId:'p',code:'throw new Error("must not execute")',limits:{cpuMs:100,memoryMb:16,timeoutMs:100,maxProcesses:1}});assert.equal(result.executed,false);assert.equal(result.reason,'EXECUTION_DISABLED');
});
test('HTTP defaults secure production cookies, CSP, HSTS, explicit CORS and CSRF requirement',()=>{
  const cfg=httpSecurityDefaults(true,['https://example.com']);assert.equal(cfg.cookies.secure,true);assert.equal(cfg.cookies.httpOnly,true);assert.equal(cfg.cookies.sameSite,'strict');assert.ok(cfg.headers['Strict-Transport-Security']);assert.equal(cfg.headers['X-Content-Type-Options'],'nosniff');assert.equal(cfg.cors.allowOrigin('https://evil.com'),false);assert.equal(cfg.cors.allowOrigin('https://example.com'),true);
  assert.throws(()=>httpSecurityDefaults(true,['*']));assert.throws(()=>httpSecurityDefaults(true,['http://example.com']));assert.equal(httpSecurityDefaults(false,[]).headers['Strict-Transport-Security'],undefined);
});
