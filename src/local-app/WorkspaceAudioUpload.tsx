import {useRef,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
export function WorkspaceAudioUpload({workspace,command,bridge,onRegistered}:{workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;bridge:EmbeddedStudioBridge;onRegistered:(material:{id:string;material_type:string;source_path:string})=>void}){
 const input=useRef<HTMLInputElement>(null),active=useRef(false),[purpose,setPurpose]=useState<'background_music'|'sound_effect'>('background_music'),[pending,setPending]=useState(false),[error,setError]=useState('');
 const disabled=!bridge.connected||workspace.stale||pending;
 async function upload(file:File){
  if(disabled||active.current)return;active.current=true;setPending(true);setError('');
  try{
   if(!file.size||file.size>100*1024*1024)throw Error('声音素材不能为空或超过100MB。');
   if(!/\.mp3$/i.test(file.name)||file.type&&!['audio/mpeg','audio/mp3'].includes(file.type))throw Error('请选择 MP3 声音素材。');
   await bridge.save();
   const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const value=String(reader.result);resolve(value.slice(value.indexOf(',')+1));};reader.onerror=()=>reject(Error('文件读取失败，请重新选择。'));reader.onabort=()=>reject(Error('文件读取已取消。'));reader.readAsDataURL(file);});
   const result=await command('importMaterial',{episodeId:workspace.episodeId,materialType:'audio',sourceKind:'file',sourcePath:file.name,mimeType:'audio/mpeg',contentBase64,isMainScript:false,materialPurpose:purpose}) as {id:string};
   onRegistered({id:result.id,material_type:'audio',source_path:file.name});
  }catch(cause){setError(cause instanceof Error?cause.message:'声音素材登记未完成。');}finally{active.current=false;setPending(false);}
 }
 return <section aria-label="添加声音素材" className="workspace-audio-upload">
  <label>声音用途<NativeSelect size="sm" aria-label="声音素材用途" value={purpose} disabled={disabled} onChange={event=>setPurpose(event.target.value as typeof purpose)}><option value="background_music">背景音乐</option><option value="sound_effect">音效</option></NativeSelect></label>
  <Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>input.current?.click()}>{pending?'正在登记声音…':'上传 MP3'}</Button>
  <input ref={input} aria-label="上传声音素材" type="file" accept=".mp3,audio/mpeg" hidden disabled={disabled} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
