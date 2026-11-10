import {useEffect,useRef,useState} from 'react';
import {Square,Volume2} from 'lucide-react';
import {speechSampleText} from '../speechSample';
import type {ProductionSelection} from '../productionSelection';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {ConfirmationModal,ConfirmationModalPresence} from '../ui/ConfirmationModal';
import {localRequest} from './client';

let activeSample:HTMLAudioElement|undefined;

export function WorkspaceSpeechSample({label,selection,voice,rate,disabled,buttonColor='secondary'}:{label:string;selection:ProductionSelection|null;voice:string;rate:number;disabled:boolean;buttonColor?:'secondary'|'tertiary'}){
 const audio=useRef<HTMLAudioElement>(null),request=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false),[playing,setPlaying]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState('');
 const rateRef=useRef(rate);
 rateRef.current=rate;
 useEffect(()=>{
  const player=audio.current;
  return()=>{request.current?.abort();player?.pause();if(activeSample===player)activeSample=undefined;};
 },[]);
 async function play(){
  const player=audio.current;
  if(!player)return;
  if(activeSample!==player)activeSample?.pause();
  activeSample=player;
  player.playbackRate=rateRef.current;
  player.currentTime=0;
  await player.play();
 }
 async function load(generate:boolean){
  if(!selection||request.current)return;
  const controller=new AbortController();
  request.current=controller;
  setBusy(true);setError('');
  try{
   if(audio.current?.getAttribute('src')){await play();return;}
   const result=await localRequest('speech-sample',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selection,voice,generate}),signal:controller.signal}) as {audioBase64:string|null};
   if(controller.signal.aborted)return;
   if(!result.audioBase64){setConfirm(true);return;}
   setConfirm(false);
   if(!audio.current)return;
   audio.current.src='data:audio/mpeg;base64,'+result.audioBase64;
   await play();
  }catch(cause){
   if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'无法播放样音，请重试。');
  }finally{
   request.current=null;
   if(!controller.signal.aborted)setBusy(false);
  }
 }
 return <>
  <div className="workspace-speech-sample">
  <Button size="sm" color={buttonColor} iconLeading={playing?Square:Volume2}
   aria-label={playing?`停止${label}音色试听`:`试听${label}音色`} title={playing?'停止试听':'试听音色'}
   isDisabled={disabled||busy} onPress={()=>playing?audio.current?.pause():void load(false)}/>
  <audio ref={audio} onPlaying={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>
  </div>
  {error&&!confirm&&<p className="workspace-speech-sample-error" role="alert">{error}</p>}
  <ConfirmationModalPresence>{confirm&&<ConfirmationModal title="准备音色样音" confirmLabel="确认合成并试听" isPending={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>load(true)}>
   <p>首次试听会合成一句「{speechSampleText}」，供应商可能按字数计费。样音保存到本机，之后可直接试听和调整播放语速。</p>
   {error&&<p role="alert">{error}</p>}
  </ConfirmationModal>}</ConfirmationModalPresence>
 </>;
}
