import {createHash} from 'node:crypto';
import {extname} from 'node:path';
import {reviewRenderFromSnapshot} from '../worker/codexRunner.js';
import {buildOpenChatCutProject} from '../worker/openchatcutProject.js';
import {defaultShotCaptionContract} from '../shotCaptions.js';
import {normalizeShotAudioMix} from '../shotAudioMix.js';
import type {ShotComposition} from '../shotComposition.js';

type RecordValue=Record<string,any>;
const record=(v:unknown):RecordValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:{};
function fail():never{throw Error('旧 HTML 工程的冻结时序不完整或格式不受支持，原工程保持不变。');}
const decode=(v:string)=>v.replace(/&(?:amp|quot|apos|lt|gt|#39|#\d+|#x[0-9a-f]+);/gi,e=>{const names:Record<string,string>={'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'};if(names[e])return names[e];const n=e.startsWith('&#x')?parseInt(e.slice(3,-1),16):Number(e.slice(2,-1));return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):fail();});
const attrs=(v:string)=>Object.fromEntries([...v.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const seconds=(v:unknown)=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):fail();
const near=(a:number,b:number)=>Math.abs(a-b)<0.002;
// Frozen HyperFrames export convention, retained from hyperframesReviewRenderer.ts.
const preparedUrl=(member:RecordValue,start=member.start_seconds,duration=member.duration_seconds)=>`assets/${createHash('sha256').update(`${member.relative_path}:${member.member_key}:${start}:${duration}`).digest('hex')}.mp4`;
const mediaUrl=(path:string)=>`assets/${createHash('sha256').update(path).digest('hex')}${extname(path)}`;
function snake(v:unknown):unknown{return Array.isArray(v)?v.map(snake):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),k==='composition'?value:snake(value)])):v;}

/** Read only the known declarative export; scripts, CSS and HTML asset URLs are never executed. */
export function importLegacyHtmlWorkspace(snapshot:Record<string,unknown>,html:string,projectId:string){
 if(html.length>4_000_000)fail();
 const raw=record(snapshot.capability==='final_rendering'?record(snapshot.final_render).review_render:snapshot.review_render);
 const root=[...html.matchAll(/<div\b([^>]*)>/g)].map(m=>attrs(m[1])).find(a=>a.id==='root');
 if(!root||root['data-composition-id']!==`review-render-v${raw.project_revision}`||!Array.isArray(raw.confirmed_shots)||!Array.isArray(raw.members))fail();
 const board=record(raw.storyboard),shots=board.shots as RecordValue[];
 if(board.version!=='storyboard/v1'||!Array.isArray(shots)||!shots.length||shots.length>500||new Set(shots.map(s=>s.id)).size!==shots.length||raw.confirmed_shots.length!==shots.length)fail();
 const visuals=[...html.matchAll(/<video\b([^>]*)>/g)].map(m=>attrs(m[1]));
 const audios=[...html.matchAll(/<audio\b([^>]*)>/g)].map(m=>attrs(m[1]));
 const cues: Array<Record<string,string>&{text:string}>=[...html.matchAll(/<div\b([^>]*\bid="caption-[^"]+"[^>]*)><span>([^<]*)<\/span><\/div>/g)].map(m=>({...attrs(m[1]),text:decode(m[2])}));
 if(visuals.some(a=>!/^shot-\d+-\d+(?:-top|-bottom)?$/.test(a.id))||audios.some(a=>!/^audio-\d+$|^source-audio-\d+-\d+$/.test(a.id))||new Set([...visuals,...audios,...cues].map(a=>a.id)).size!==visuals.length+audios.length+cues.length)fail();
 if((html.match(/id="caption-/g)??[]).length!==cues.length||raw.members.some((m:RecordValue)=>!['shot_media','narration'].includes(m.member_kind)))fail();
 let narrationIndex=0,end=0;
 const windows: Array<{id:string;start:number;duration:number;nodes:ReturnType<typeof attrs>[];cues:typeof cues}>=[];
 const normalized=structuredClone(raw);
 for(const [index,shot] of shots.entries()){
  const confirmed=normalized.confirmed_shots.find((s:RecordValue)=>s.shot_id===shot.id),members=normalized.members.filter((m:RecordValue)=>m.member_key===`shot:${shot.id}`),nodes=visuals.filter(a=>a.id.startsWith(`shot-${index}-`));
  if(!confirmed||confirmed.confirmation_status!=='confirmed'||members.length!==1||members[0].media_missing||!nodes.length||!Array.isArray(confirmed.clip_segments)||!confirmed.clip_segments.length)fail();
  const member=members[0],segments=confirmed.clip_segments as RecordValue[],start=Math.min(...nodes.map(a=>seconds(a['data-start']))),last=Math.max(...nodes.map(a=>seconds(a['data-start'])+seconds(a['data-duration']))),duration=last-start;
  if(!near(start,end)||duration<=0||JSON.stringify(member.clip_segments)!==JSON.stringify(segments))fail();
  const split=nodes.length===2&&nodes.some(a=>a.id===`shot-${index}-0-top`)&&nodes.some(a=>a.id===`shot-${index}-0-bottom`);
  if(split?segments.length!==1:nodes.length!==segments.length)fail();
  const expectedIds=split?[`shot-${index}-0-top`,`shot-${index}-0-bottom`]:segments.map((_s,n)=>`shot-${index}-${n}`);if(nodes.some((a,n)=>a.id!==expectedIds[n]))fail();
  let offset=0;
  for(const [n,segment] of segments.entries()){
   const targets=split?nodes:nodes.filter(a=>a.id===`shot-${index}-${n}`),length=Number(segment.end_seconds)-Number(segment.start_seconds);
   if(!Number.isFinite(length)||length<=0||targets.length!==(split?2:1)||targets.some(a=>a['data-media-start']!==undefined&&!near(seconds(a['data-media-start']),Number(segment.start_seconds))||a.src===mediaUrl(member.relative_path)&&Number(segment.start_seconds)>0&&a['data-media-start']===undefined||![mediaUrl(member.relative_path),preparedUrl(member),preparedUrl(member,segment.start_seconds,length)].includes(a.src)||!near(seconds(a['data-start']),start+offset)||!near(seconds(a['data-duration']),length)))fail();offset+=length;
  }
  const fit=nodes.every(a=>(a.class??'').split(' ').includes('shot-b-roll'))?'contain':'cover';
  const composition:ShotComposition={version:'shot-composition/v1',layout:split?'2up-vertical':'full',slots:(split?['top','bottom']:['full']).map(id=>({id,clipSegmentIndex:0,fit,focalPoint:{x:.5,y:.5}}))};
  const localCues=cues.filter(a=>new RegExp(`^caption-${index}(?:-\\d+)?$`).test(a.id));
  if(localCues.some(c=>!c.text.trim()||seconds(c['data-start'])<start-.002||seconds(c['data-start'])+seconds(c['data-duration'])>last+.002))fail();
  const enabled=Boolean(record(raw.adjustments).captions_enabled&&confirmed.subtitles_enabled);
  if(enabled!==!!localCues.length||enabled&&localCues.map(c=>c.text).join('').replace(/\s/gu,'')!==String(confirmed.subtitle_text).replace(/\s/gu,''))fail();
  const contract=defaultShotCaptionContract(confirmed.subtitle_text,confirmed.audio_mode==='tts'?'follow_tts':'independent',enabled);
  contract.cues=localCues.map(c=>({id:c.id,text:c.text,startMs:Math.max(0,Math.round((seconds(c['data-start'])-start)*1000)),endMs:Math.round((seconds(c['data-start'])+seconds(c['data-duration'])-start)*1000)}));
  contract.spatial={...contract.spatial,anchor:split?'middle-center':'bottom-center',safeArea:'custom',insets:{left:72/Number(root['data-width']),right:72/Number(root['data-width']),top:0,bottom:split?0:150/Number(root['data-height'])},maxCharactersPerLine:24};
  const mode=confirmed.audio_mode;
  if(!['tts','source','none'].includes(mode))fail();
  const voiceMembers=normalized.members.filter((m:RecordValue)=>m.member_key===`narration:${shot.id}`);
  if(mode==='tts'){
   const node=audios.find(a=>a.id===`audio-${narrationIndex}`),voice=voiceMembers[0];
   if(voiceMembers.length!==1||!node||node.src!==mediaUrl(voice.relative_path)||voice.audio_track_id!==confirmed.audio_track_id||!near(seconds(node['data-duration']),Number(voice.duration_seconds))||!near(seconds(node['data-start']),start)||seconds(node['data-volume'])!==1)fail();
   voice.start_seconds=seconds(node['data-start']);narrationIndex++;
  }else if(voiceMembers.length)fail();
  const sourceAudios=audios.filter(a=>a.id.startsWith(`source-audio-${index}-`));
  if(mode==='source'?(segments.length!==1||sourceAudios.length!==1||![mediaUrl(member.relative_path),preparedUrl(member),preparedUrl(member,segments[0].start_seconds,Number(segments[0].end_seconds)-Number(segments[0].start_seconds))].includes(sourceAudios[0].src)||!near(seconds(sourceAudios[0]['data-start']),start)||!near(seconds(sourceAudios[0]['data-duration']),duration)||seconds(sourceAudios[0]['data-volume'])!==1):sourceAudios.length!==0)fail();
  const mix=normalizeShotAudioMix(undefined,{audioMode:mode,audioTrackId:confirmed.audio_track_id});
  mix.mainVoice.gainDb=mode==='tts'?Number(record(raw.adjustments).narration_gain_db??0):0;
  confirmed.composition=composition;member.composition=composition;
  // This contract describes the new editable copy, never a backdated approval.
  confirmed.preparation_contract={version:'shot-preparation/v1',storyboard_fingerprint:createHash('sha256').update(JSON.stringify(board)).digest('hex'),source_material_revision_id:confirmed.source_material_revision_id??null,clip_segments:segments,composition,transition_mode:record(raw.adjustments).transition==='fade'?'fade':'cut',audio_mode:mode,audio_track_id:confirmed.audio_track_id,tts_text:null,tts_voice:null,tts_speaking_rate:null,audio_mix:snake(mix),captions:snake(contract),input_fingerprint:confirmed.input_fingerprint};
  windows.push({id:shot.id,start,duration,nodes,cues:localCues});end=last;
 }
 if(raw.members.length!==shots.length+narrationIndex||new Set(raw.members.map((m:RecordValue)=>m.member_key)).size!==raw.members.length||visuals.length!==windows.reduce((n,w)=>n+w.nodes.length,0)||audios.length!==narrationIndex+windows.filter((_w,i)=>normalized.confirmed_shots[i].audio_mode==='source').length||cues.length!==windows.reduce((n,w)=>n+w.cues.length,0)||!near(seconds(root['data-duration']),end)||Number(root['data-width'])!==Number(record(raw.adjustments).width)||Number(root['data-height'])!==Number(record(raw.adjustments).height))fail();
 const render=reviewRenderFromSnapshot({capability:'review_rendering',review_render:normalized});if(!render)fail();
 // A saved native document has priority over reconstruction (including manual edits).
 const project=buildOpenChatCutProject(render,projectId),timeline=project.timelines[0],fps=timeline.fps;
 if(html.includes('font-size:70px'))for(const track of Object.values(timeline.tracks))if(track.captions){track.captions.template='plain';track.captions.styleOverride={fontFamily:'PingFang SC',fontSize:70/timeline.height,fontWeight:900,color:'#fffdf2',highlightColor:'#fffdf2',strokeColor:'#10131a',strokeWidth:3,background:'transparent',wholeLine:true};}
 for(const w of windows){
  const visual=timeline.items.filter(i=>String(i.id).startsWith(`shot-${w.id}-`));if(visual.length!==w.nodes.length)fail();
  for(const [i,item] of visual.entries()){
   const node=w.nodes[i];item.startFrame=Math.round(seconds(node['data-start'])*fps);item.durationInFrames=Math.max(1,Math.round((seconds(node['data-start'])+seconds(node['data-duration']))*fps)-Number(item.startFrame));
   if(html.includes('filter:saturate(.82) contrast(1.08) brightness(.82)'))item.filters={saturate:.82,contrast:1.08,brightness:.82};
   if(html.includes('scale:1.05')){const base=Number(record(item.transform).scale??1);item.keyframes={scale:[{frame:0,value:base,easing:'easeOut'},{frame:Math.max(1,Number(item.durationInFrames)-1),value:base*1.05}]};}
  }
  const source=timeline.items.find(i=>i.id===`main-source-${w.id}`);if(source){source.startFrame=Math.round(w.start*fps);source.durationInFrames=Math.round((w.start+w.duration)*fps)-Number(source.startFrame);}
  for(const track of Object.values(timeline.tracks))for(const lane of track.captions?.sourceEntries??[])if(lane.id===`lane-${w.id}`)lane.words=w.cues.map((c,i)=>({id:lane.words[i]?.id??c.id,text:c.text,start:Math.round(seconds(c['data-start'])*fps)*1000/fps,end:Math.round((seconds(c['data-start'])+seconds(c['data-duration']))*fps)*1000/fps}));
 }
 return{project,render};
}
