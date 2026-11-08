import {registeredAdapters,productionCapabilityLabels} from '../worker/registeredAdapters.js';
export interface ConnectionModel {id:string; capability:string; adapted:boolean; listed:boolean; reason?:string}
export interface ConnectionModelSettings {
 connectionId:string; versionId:string; revision:string; enabledModels:string[];
 models:ConnectionModel[]; discovery:{supported:boolean; detail:string; readAt:string|null};
}
export interface ConnectionModelRequest {connectionId:string;versionId:string;revision?:string;enabledModels?:string[]}
export function registeredConnectionModels(provider:string,adapter:string):ConnectionModel[]{
 return registeredAdapters.productionChoices().filter(c=>c.provider===provider&&c.adapter===adapter&&c.mode==='generation').flatMap(c=>c.models.map(id=>({id,capability:productionCapabilityLabels[c.capability],adapted:true,listed:false})));
}
export function modelDiscoveryAvailability(provider:string){
 return ['openai','minimax','bailian'].includes(provider)
  ?{supported:true,detail:'读取供应商目录不会生成内容；目录不代表生成权限。',readAt:null}
  :{supported:false,detail:'当前凭据没有可用的公开模型目录，以下为本平台支持的模型。',readAt:null};
}

/** Expanding a contract does not silently enable more models on existing connections. */
export function defaultConnectionModels(provider:string,adapter:string){const models=registeredConnectionModels(provider,adapter);return provider==='bailian'&&adapter==='wan_video'?models.filter(m=>m.id==='wan2.6-i2v-flash'):provider==='kling'?models.filter(m=>m.id==='kling-v3'):models;}
