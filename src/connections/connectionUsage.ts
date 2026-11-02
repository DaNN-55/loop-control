export interface ConnectionUsageMetric {label:string;text:string;detail:string;status:'ready'|'unavailable'|'unsupported'|'loading'}
export interface ConnectionUsageSummary {remaining:ConnectionUsageMetric;recent:ConnectionUsageMetric;updatedAt:string|null}
export interface ConnectionUsageRead {connectionId:string;versionId:string;usage:ConnectionUsageSummary}
export const connectionUsageSupported=(provider:string)=>['kling','freesound','pexels','bailian','volcengine','volcengine_tts','openai','minimax'].includes(provider);
export function connectionUsagePlaceholder(provider:string):ConnectionUsageSummary{
 if(provider==='minimax')return{remaining:{label:'可用额',text:'读取中…',detail:'正在读取 MiniMax 账号可用额，可能包含代金券和信用额度，不等于现金余额。',status:'loading'},recent:{label:'近7天',text:'暂不支持',detail:'尚未找到可确认的官方近7天账单查询接口，请在 MiniMax 所属站点控制台查看；不使用余额差额或本平台预留估算花费。',status:'unsupported'},updatedAt:null};
 const supported=['kling','freesound','pexels'].includes(provider),management=['openai','bailian','volcengine','volcengine_tts'].includes(provider);
 const text=supported?'读取中…':management?'需账务权限':provider==='pexels'?'按请求限额':'未接入';
 const detail=supported?'正在读取供应商数据。':management?'现有生成 Key 不提供账务查询；需单独接入有权限的账号账务凭据。':provider==='pexels'?'Pexels 提供请求次数限额，剩余量来自实际调用的响应头；当前未接入该统计。':'未接入官方可用的余额或账单接口，请在服务控制台查看。';
 return{remaining:{label:provider==='freesound'?'日余量':provider==='pexels'?'请求余量':'余量',text:provider==='openai'?'未提供接口':text,detail:provider==='openai'?'未找到官方公开的预付余额查询接口，请在控制台查看。':detail,status:supported?'loading':'unsupported'},recent:{label:provider==='kling'?'7天任务':'近7天',text:provider==='pexels'?'未提供历史':supported?'读取中…':management?'需账务权限':'未接入',detail:provider==='pexels'?'供应商未提供近7天历史请求查询接口；不使用本平台估算补数。':detail,status:provider==='pexels'?'unsupported':supported?'loading':'unsupported'},updatedAt:null};
}

/** Scope follows the existing read-only provider endpoints, never a per-connection wallet. */
export function connectionUsageScope(provider:string):string|null{
 if(['minimax','openai','bailian','volcengine','volcengine_tts'].includes(provider))return '供应商账号可用额';
 if(['pexels','freesound'].includes(provider))return 'Key 请求余量';
 if(provider==='kling')return '账号资源包';
 return null;
}
