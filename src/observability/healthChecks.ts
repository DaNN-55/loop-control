export const healthCheckLabels = {database:'数据库',media_directory:'媒体目录',runtime:'运行程序'} as const;
export interface HealthCheck {id:keyof typeof healthCheckLabels;passed:boolean;detail:string}
export interface HealthResult {passed:boolean;detail:string;checks?:HealthCheck[]}

// Old records have no breakdown. Reject incomplete or malformed persisted data.
export function readHealthChecks(value:unknown):HealthCheck[]|undefined {
 if(!Array.isArray(value)||value.length!==3)return undefined;
 const checks:HealthCheck[]=[];
 for(const item of value){
  if(!item||typeof item.id!=='string'||!Object.hasOwn(healthCheckLabels,item.id)||checks.some(check=>check.id===item.id)||typeof item.passed!=='boolean'||typeof item.detail!=='string'||item.detail.length>500)return undefined;
  checks.push({id:item.id,passed:item.passed,detail:item.detail});
 }
 return checks;
}
