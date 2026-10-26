// A sent request may have reached the Provider even when no result was received.
export class ProviderOutcomeUnknownError extends Error {
 constructor(){
  super("Provider 请求结果未知；已消费的请求预算保留。请先核对请求账本与供应商记录，不会自动重发。" );
  this.name='ProviderOutcomeUnknownError';
 }
}
