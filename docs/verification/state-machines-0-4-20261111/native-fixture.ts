import {applyWorkspaceCaptionEdit} from '../../../src/workspaceCaptions';
import type {ShotCaptionContract} from '../../../src/shotCaptions';
import type {OpenChatCutProject} from '../../../src/worker/openchatcutProject';
const params=new URLSearchParams(location.search),channel=params.get('lcChannel'),projectId=params.get('lcProject'),origin=params.get('lcParent')!;
let project:OpenChatCutProject=await fetch('/__native').then(response=>response.json()),revision=1;
const fingerprint=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(project))))].map(value=>value.toString(16).padStart(2,'0')).join('');
const send=(data:Record<string,unknown>)=>parent.postMessage({channel,projectId,...data},origin);
addEventListener('message',async event=>{
 const message=event.data;
 if(event.source!==parent||event.origin!==origin||message.channel!==channel||message.projectId!==projectId)return;
 try{
  let result:unknown;
  if(message.action==='inspect')result={revision,documentFingerprint:await fingerprint(),document:project};
  if(message.action==='apply-captions'){
   if(message.expectedRevision!==revision||message.expectedDocumentFingerprint!==await fingerprint())throw Error('原生版本不符');
   project=applyWorkspaceCaptionEdit(project,message.itemId,message.contract as ShotCaptionContract,{timingOnly:message.timingOnly===true});revision++;
   await fetch('/__native',{method:'POST',body:JSON.stringify(project)});
   result={revision,documentFingerprint:await fingerprint(),document:project};
  }
  if(message.action==='flush')await fetch('/__native',{method:'POST',body:JSON.stringify(project)});
  send({type:'loop-control:result',requestId:message.requestId,ok:true,result});
 }catch(cause){send({type:'loop-control:result',requestId:message.requestId,ok:false,error:String(cause)});}
});
send({type:'loop-control:state',writable:true,revision,items:[],selectedIds:[]});
setTimeout(()=>send({type:'loop-control:caption-alignment-requested'}),250);
