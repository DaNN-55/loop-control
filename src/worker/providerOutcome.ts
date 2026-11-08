// A sent request may have reached the Provider even when no result was received.
export class ProviderOutcomeUnknownError extends Error {
 constructor(timeoutMs?:number){
  super((timeoutMs===undefined?'Provider 请求结果未知':`等待供应商响应超时（${timeoutMs/1000} 秒），提交结果未知`)+
   '；已消费的请求预算保留。请先核对请求账本与供应商记录，不会自动重发。');
  this.name='ProviderOutcomeUnknownError';
 }
}
export function isDefiniteProviderRejection(status:number){
 return status>=400&&status<500&&status!==408;
}
