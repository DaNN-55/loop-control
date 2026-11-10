import {useEffect,useMemo,useRef,useState} from 'react';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import {videoVisualInputRoles} from '../videoVisualInputs';
import {localRequest} from './client';

export interface ProductionCatalogReading {
 catalog:ProductionServiceCatalog|null;
 pending:boolean;
 error:Error|null;
 refresh:()=>void;
}

function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
const isCount=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0;
function isVideoModes(value:unknown):boolean{
 if(!isRecord(value))return false;
 return Object.values(value).every(modes=>Array.isArray(modes)&&modes.length>0&&modes.every((mode:unknown)=>{
  if(!isRecord(mode)||typeof mode.id!=='string'||!mode.id.trim()||typeof mode.label!=='string'||!mode.label.trim()||!isRecord(mode.inputs))return false;
  for(const key of ['allowAssetVideoSource','allowInlineMp4','characterOrder'])if(mode[key]!==undefined&&typeof mode[key]!=='boolean')return false;
  if(mode.referenceImageSource!==undefined&&mode.referenceImageSource!=='https')return false;
  for(const key of ['maxReferences','maxImagesWithVideo'])if(mode[key]!==undefined&&!isCount(mode[key]))return false;
  if(mode.videoSeconds!==undefined){
   const seconds=mode.videoSeconds;
   if(!isRecord(seconds)||typeof seconds.min!=='number'||!Number.isFinite(seconds.min)||seconds.min<0||typeof seconds.max!=='number'||!Number.isFinite(seconds.max)||seconds.max<seconds.min)return false;
  }
  return Object.entries(mode.inputs).every(([role,limit])=>{
   if(!videoVisualInputRoles.some(known=>known===role)||!isRecord(limit)||!isCount(limit.max))return false;
   if(limit.min!==undefined&&(!isCount(limit.min)||limit.min>limit.max))return false;
   if(limit.maxBytes!==undefined&&(!isCount(limit.maxBytes)||limit.maxBytes===0))return false;
   return limit.mimeTypes===undefined||Array.isArray(limit.mimeTypes)&&limit.mimeTypes.every(mime=>typeof mime==='string');
  });
 }));
}

function isCatalog(value:unknown):value is ProductionServiceCatalog{
 if(!value||typeof value!=='object'||!('groups' in value)||!Array.isArray(value.groups))return false;
 return value.groups.every(group=>{
  if(!group||!['image','video','speech','music_sound'].includes(group.capability)||!Array.isArray(group.services))return false;
  return group.services.every((service:Record<string,unknown>|null)=>{
   if(!service||typeof service!=='object'||typeof service.id!=='string'||typeof service.provider!=='string'||typeof service.adapter!=='string'||typeof service.executable!=='boolean')return false;
   if(service.mode!==undefined&&!['generation','search','local'].includes(String(service.mode)))return false;
   const pexelsSearch=group.capability==='video'&&service.mode==='search'&&service.provider==='pexels'&&service.adapter==='pexels_video';
   if(service.mode==='search'&&!pexelsSearch&&group.capability!=='music_sound')return false;
   const modelsRequired=group.capability!=='music_sound'&&!pexelsSearch;
   if((modelsRequired||service.models!==undefined)&&(!Array.isArray(service.models)||!service.models.every(model=>typeof model==='string')))return false;
   if(service.videoGenerationModes!==undefined&&!isVideoModes(service.videoGenerationModes))return false;
   const constraintsRequired=['video','speech'].includes(group.capability)&&!pexelsSearch;
   return (!constraintsRequired&&service.constraints===undefined)||!!service.constraints&&typeof service.constraints==='object'&&!Array.isArray(service.constraints);
  });
 });
}

/** Each reader owns its lifetime; only embedded callers share the same snapshot. */
export function useProductionServiceCatalog({scope,active=true,refreshKey}:{scope:string;active?:boolean;refreshKey?:string}):ProductionCatalogReading{
 const current=useRef<object|null>(null);
 const [view,setView]=useState<{owner:object;catalog:ProductionServiceCatalog|null;pending:boolean;error:Error|null}|null>(null);
 const reading=useMemo(()=>{
  const owner={};let alive=false,expired=false,sequence=0,request:AbortController|undefined,catalog:ProductionServiceCatalog|null=null;
  function refresh(){
   if(!active||!alive||expired||current.current!==owner)return;
   const issued=++sequence;request?.abort();const controller=new AbortController();request=controller;
   const owns=()=>alive&&!expired&&current.current===owner&&issued===sequence&&!controller.signal.aborted;
   setView({owner,catalog,pending:true,error:null});
   void localRequest('connections',{signal:controller.signal}).then(value=>{
    if(!owns())return;
    if(!isCatalog(value.serviceCatalog))throw Error('制作目录格式无效。');
    catalog=value.serviceCatalog;setView({owner,catalog,pending:false,error:null});
   }).catch(cause=>{if(owns())setView({owner,catalog,pending:false,error:cause instanceof Error?cause:Error('无法读取制作目录。')});});
  }
  function stop(){alive=false;sequence++;request?.abort();}
  return {owner,refresh,start(){alive=true;refresh();},stop,expire(){expired=true;stop();setView({owner,catalog:null,pending:false,error:null});}};
 },[scope,active]);
 current.current=reading.owner;
 useEffect(()=>{
  if(!active)return;
  reading.start();window.addEventListener('focus',reading.refresh);window.addEventListener('loop-local-session-expired',reading.expire);
  return()=>{reading.stop();window.removeEventListener('focus',reading.refresh);window.removeEventListener('loop-local-session-expired',reading.expire);};
 },[reading,active,refreshKey]);
 const value=view?.owner===reading.owner?view:null;
 return {catalog:value?.catalog??null,pending:active&&(value?.pending??true),error:value?.error??null,refresh:reading.refresh};
}
