import argon2 from 'argon2';
/** Fixed server policy; never accept Argon2 parameters from HTTP. */
export const PASSWORD_POLICY=Object.freeze({minLength:12,maxLength:128,memoryCost:65536,timeCost:3,parallelism:1});
export function validPassword(value:unknown):value is string {return typeof value==='string'&&value.length>=12&&value.length<=128&&Buffer.byteLength(value,'utf8')<=512&&!/[\u0000]/.test(value);}
let active=0;
async function bounded<T>(work:()=>Promise<T>):Promise<T>{if(active>=2)throw new Error('AUTH_BUSY');active++;try{return await work();}finally{active--;}}
export async function hashPassword(value:string):Promise<string>{if(!validPassword(value))throw new Error('INVALID_PASSWORD');return bounded(()=>argon2.hash(value,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}));}
export async function verifyPassword(hash:string,value:string):Promise<boolean>{if(!validPassword(value))return false;return bounded(()=>argon2.verify(hash,value));}
