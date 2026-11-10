import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceAudioPreparation} from '../../../src/local-app/WorkspaceAudioPanel';
import {WorkspaceVisualTaskStatus} from '../../../src/local-app/WorkspaceVisualTaskStatus';
import {WorkspaceDeliveryPanel} from '../../../src/local-app/WorkspaceDeliveryPanel';
import {useWorkspaceCallConfirmation} from '../../../src/local-app/useWorkspaceCallConfirmation';
import {audioFixture,deliveryFixture} from './fixture-data.mjs';
import type {ProductionWorkspace} from '../../../src/productionWorkspace';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';

function Fixture(){
 const [audio,setAudio]=useState(audioFixture),[delivery,setDelivery]=useState(deliveryFixture),[showDelivery,setShowDelivery]=useState(false),[events,setEvents]=useState<string[]>([]);
 const record=(value:string)=>setEvents(current=>[...current,value]);
 const confirmation=useWorkspaceCallConfirmation(async(name)=>{record(name);return name==='prepareWorkspaceCall'?{confirmationId:'isolated-confirmation',expiresAt:'2099-01-01T00:00:00Z',summary:{kind:'图片生成',target:'shot',provider:'controlled',model:'fixture-image',connection:'隔离验证连接',parameters:['1 张'],inputs:[],prompt:'图片未知结果重试核对',reservationCents:125,retryOfTaskId:'image-unknown'}}:{};},'isolated-images');
 useEffect(()=>{const supply=(event:Event)=>{const next=(event as CustomEvent<{revision:number;deliveryId?:string;status?:string}>).detail;setDelivery(deliveryFixture(next.revision,next.deliveryId,next.status));};window.addEventListener('fixture-delivery',supply);return()=>window.removeEventListener('fixture-delivery',supply);},[]);
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24,minWidth:0}}><h1>任务展示与交付读取核对</h1>
  <WorkspaceAudioPreparation workspace={audio as ProductionWorkspace} command={async(name,data)=>{record(name+':'+JSON.stringify(data));return audio;}} onChange={setAudio} selectedShotId="shot"/>
  <WorkspaceVisualTaskStatus task={{id:'video',taskId:'video-original',status:'blocked',kind:'video',providerTaskId:'remote-original',canResume:true,error:null}} label="视频" onResume={()=>record('resume:remote-original')} onRefresh={()=>{}} onReconcile={()=>{}}/>
  <WorkspaceVisualTaskStatus task={{id:'image',taskId:'image-unknown',status:'failed',kind:'image',submissionUnknown:true,submissionOutcome:'started',error:null}} label="图片" onRetryUnknown={()=>void confirmation.request('requestWorkspaceImageCandidates',{episodeId:'audio-fixture',workspaceId:'audio-workspace',expectedRevision:1,retryOfTaskId:'image-unknown',settings:{count:1}}).catch(()=>{})} onResume={()=>{}} onRefresh={()=>record('refresh:image-unknown')} onReconcile={()=>{}}/>
  <p><button onClick={()=>setShowDelivery(value=>!value)}>{showDelivery?'关闭交付核对':'打开交付核对'}</button></p>
  <p>交付页面版本：<output id="delivery-revision">{delivery.revision}</output></p>
  {showDelivery&&<WorkspaceDeliveryPanel workspace={delivery as ProductionWorkspace} pending={false} command={async()=>delivery} onChange={value=>{record('delivery-publish:'+value.revision);setDelivery(value);}}/>}
  <ol aria-label="核对事件">{events.map((event,index)=><li key={index}>{event}</li>)}</ol>
 </main>{confirmation.dialog}</div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
