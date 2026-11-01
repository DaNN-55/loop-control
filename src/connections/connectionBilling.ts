import type {ConnectionUsageSummary} from './connectionUsage.js';
export type BillingProvider='aliyun'|'volcengine'|'openai';
export const billingProvider=(provider:string):BillingProvider|null=>provider==='bailian'?'aliyun':['volcengine','volcengine_tts'].includes(provider)?'volcengine':provider==='openai'?'openai':null;
export const billingProviderLabels:Record<BillingProvider,string>={aliyun:'阿里云（中国站）',volcengine:'火山引擎（中国站）',openai:'OpenAI'};
export interface ConnectionBillingSettings {connectionId:string;provider:BillingProvider;configured:boolean;revision:string;updatedAt:string|null;usage?:ConnectionUsageSummary}
export interface ConnectionBillingActions {
 onReadBilling?:(connectionId:string)=>Promise<ConnectionBillingSettings>;
 onSaveBilling?:(input:{connectionId:string;revision:string;credential:string},operationKey:string)=>Promise<ConnectionBillingSettings>;
 onRefreshBilling?:(input:{connectionId:string;revision:string})=>Promise<ConnectionBillingSettings>;
 onDisconnectBilling?:(input:{connectionId:string;revision:string})=>Promise<ConnectionBillingSettings>;
}
