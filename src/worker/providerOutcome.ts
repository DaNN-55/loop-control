// A sent request may have reached the Provider even when no result was received.
export class ProviderRequestNotSentError extends Error {
 readonly code='PROVIDER_REQUEST_NOT_SENT';
 constructor(readonly reason:'input_changed'|'prior_request'|'temporary_failure'){
  super(reason==='prior_request'?'本次尚未发送；输入或原请求状态需要核对，请刷新后继续。':reason==='temporary_failure'?'本次尚未发送；本机准备未能恢复，请检查本机状态后重试。':'本次尚未发送；输入、授权或配置已变化，请核对后重试。');
  this.name='ProviderRequestNotSentError';
 }
}
export class ProviderOutcomeUnknownError extends Error {
 constructor(timeoutMs?:number,reason?:string){
  super((timeoutMs===undefined?'Provider 请求结果未知':`等待供应商响应超时（${timeoutMs/1000} 秒），提交结果未知`)+
   (reason?`（${reason}）`:'')+'；已消费的请求预算保留。请先核对请求账本与供应商记录，不会自动重发。');
  this.name='ProviderOutcomeUnknownError';
 }
}
export function isDefiniteProviderRejection(status:number){
 return status>=400&&status<500&&status!==408;
}

/** Recognized rejection before any usable result, never a claim of no charge. */
export class ProviderRequestRejectedError extends Error{
 readonly code='PROVIDER_REQUEST_REJECTED';
 constructor(readonly providerCode:number){super(`供应商已拒绝本次请求（${providerCode}），请检查参数或权限后重新确认。`);this.name='ProviderRequestRejectedError';}
}
