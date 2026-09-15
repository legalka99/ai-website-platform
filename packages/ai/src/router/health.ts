import type { ProviderId } from './types.js';
export type ProviderHealth = 'healthy'|'degraded'|'unavailable';
/** Local advisory health, not a distributed circuit breaker. */
export class ProviderHealthTracker {
  #state=new Map<ProviderId,{status:ProviderHealth; failures:number; until:number}>();
  constructor(private readonly now=()=>Date.now()) {}
  status(id:ProviderId):ProviderHealth { const s=this.#state.get(id); if(!s || s.until<=this.now()) {this.#state.delete(id);return 'healthy';} return s.status; }
  success(id:ProviderId):void {this.#state.delete(id);}
  transientFailure(id:ProviderId):void { const count=(this.status(id)==='healthy'?0:this.#state.get(id)?.failures??0)+1;this.#state.set(id,{status:count>=2?'unavailable':'degraded',failures:count,until:this.now()+30000}); }
  unavailable(id:ProviderId):void {this.#state.set(id,{status:'unavailable',failures:2,until:this.now()+30000});}
}
