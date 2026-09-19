import {BLOCK_TYPES,type BlockType} from '../../../core/src/block-generation.js';
import {safeContentValidationError,type ContentValidationError} from './content-validation-error.js';
import type {ProviderId} from '../router/types.js';

export const BLOCK_PUBLIC_FIELDS=['pageTitle','heading','text','points','callToAction'] as const;
export type BlockPublicField=typeof BLOCK_PUBLIC_FIELDS[number];
export interface BlockRuntimeDiagnostic {
 requestedType:BlockType|null;
 intentBlockType:BlockType|null;
 taskBlockTypeExists:boolean;
 confirmedFactCount:number;
 advantagesFactCount:number;
 structuredAdvantageCount:number;
 fragmentCount:number;
 legacyFragmentCount:number;
 fragmentGroupValid:boolean;
 sectionType:BlockType|null;
 initialValidation:'pass'|'fail'|'not_reached';
 deterministicPathActivated:boolean;
 transformedFields:BlockPublicField[];
 droppedFields:BlockPublicField[];
 finalValidation:'pass'|'fail'|'not_reached';
 finalGrounding:ContentValidationError|null;
 providerUsed:ProviderId|null;
 fallbackActivated:boolean;
 developerReached:boolean;
 qaReached:boolean;
}
const keys=['requestedType','intentBlockType','taskBlockTypeExists','confirmedFactCount','advantagesFactCount','structuredAdvantageCount','fragmentCount','legacyFragmentCount','fragmentGroupValid','sectionType','initialValidation','deterministicPathActivated','transformedFields','droppedFields','finalValidation','finalGrounding','providerUsed','fallbackActivated','developerReached','qaReached'] as const;
const read=(value:object,key:string)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;};
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=1000;
const fieldList=(value:unknown):value is BlockPublicField[]=>Array.isArray(value)&&value.length<=BLOCK_PUBLIC_FIELDS.length&&value.every((field,index)=>BLOCK_PUBLIC_FIELDS.includes(field)&&value.indexOf(field)===index);
const blockType=(value:unknown):value is BlockType=>(BLOCK_TYPES as readonly unknown[]).includes(value);
/** Strict value-only projection for internal observability. No accessors or extra data survive. */
export function safeBlockRuntimeDiagnostic(value:unknown):BlockRuntimeDiagnostic|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key as typeof keys[number])))return;
 const requestedType=read(value,'requestedType'),intentBlockType=read(value,'intentBlockType'),sectionType=read(value,'sectionType');
 const initialValidation=read(value,'initialValidation'),finalValidation=read(value,'finalValidation'),providerUsed=read(value,'providerUsed');
 const transformedFields=read(value,'transformedFields'),droppedFields=read(value,'droppedFields'),rawGrounding=read(value,'finalGrounding');
 const finalGrounding=rawGrounding===null?null:safeContentValidationError(rawGrounding);
 if(!(requestedType===null||blockType(requestedType))||!(intentBlockType===null||blockType(intentBlockType))||!(sectionType===null||blockType(sectionType))||
  !['pass','fail','not_reached'].includes(initialValidation)||!['pass','fail','not_reached'].includes(finalValidation)||!(providerUsed===null||providerUsed==='openai'||providerUsed==='yandex')||
  !fieldList(transformedFields)||!fieldList(droppedFields)||!(rawGrounding===null||finalGrounding?.stage==='content-grounding')||
  !count(read(value,'confirmedFactCount'))||!count(read(value,'advantagesFactCount'))||!count(read(value,'structuredAdvantageCount'))||!count(read(value,'fragmentCount'))||!count(read(value,'legacyFragmentCount'))||
  ['taskBlockTypeExists','fragmentGroupValid','deterministicPathActivated','fallbackActivated','developerReached','qaReached'].some(key=>typeof read(value,key)!=='boolean'))return;
 return {requestedType,intentBlockType,taskBlockTypeExists:read(value,'taskBlockTypeExists'),confirmedFactCount:read(value,'confirmedFactCount'),advantagesFactCount:read(value,'advantagesFactCount'),structuredAdvantageCount:read(value,'structuredAdvantageCount'),fragmentCount:read(value,'fragmentCount'),legacyFragmentCount:read(value,'legacyFragmentCount'),fragmentGroupValid:read(value,'fragmentGroupValid'),sectionType,initialValidation,deterministicPathActivated:read(value,'deterministicPathActivated'),transformedFields:[...transformedFields],droppedFields:[...droppedFields],finalValidation,finalGrounding:finalGrounding??null,providerUsed,fallbackActivated:read(value,'fallbackActivated'),developerReached:read(value,'developerReached'),qaReached:read(value,'qaReached')};
}
