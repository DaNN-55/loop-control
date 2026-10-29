import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useRef,useState} from 'react';
export function ConnectionTestButton({disabled=false,testing=false,showResult=true,onTest}:{showResult?:boolean;disabled?:boolean;testing?:boolean;onTest:()=>Promise<unknown>}){
 const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),running=useRef(false);
 async function test(){if(running.current||disabled)return;running.current=true;setPending(true);setMessage('');setFailed(false);
  try{const result=await onTest() as {detail?:string;ready?:boolean}|undefined;setMessage(result?.detail??'测试请求已结束，请查看当前连接状态。');setFailed(result?.ready===false);}
  catch(error){setMessage(error instanceof Error?error.message:'连接测试未完成，请重试。');setFailed(true);}
  finally{running.current=false;setPending(false);}
 }
 return <div className="connection-test-feedback"><Button size="xs" color="secondary" isLoading={pending||testing} showTextWhileLoading className="button button-secondary button-small" isDisabled={disabled||pending||testing} onClick={()=>void test()} type="button">{pending||testing?'测试中…':'重新测试'}</Button>{showResult&&message&&<p className={failed?'form-error':'muted-copy'} role={failed?'alert':'status'}>{message}</p>}</div>;
}
