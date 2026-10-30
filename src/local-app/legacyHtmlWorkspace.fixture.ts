import {createHash} from 'node:crypto';
import {extname} from 'node:path';
import type {WorkerTaskPackage} from '../worker/contracts';
import {captionCuesForShot} from '../shotCaptions';
export function legacyHtmlFixture(input:NonNullable<WorkerTaskPackage['reviewRender']>,splitFirst=false){
 const mediaUrl=(path:string)=>`assets/${createHash('sha256').update(path).digest('hex')}${extname(path)}`;
 const render=structuredClone(input),escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');let start=0,narrationIndex=0;const nodes:string[]=[];
 for(const [index,shot] of render.storyboard.shots.entries()){
  const frozen=render.confirmedShots.find(s=>s.shotId===shot.id)!,member=render.members.find(m=>m.memberKey===`shot:${shot.id}`)!,segments=member.clipSegments??frozen.clipSegments??frozen.preparationContract.clipSegments;let offset=0;
  for(const [n,segment] of segments.entries()){
   const duration=segment.endSeconds-segment.startSeconds;
   for(const slot of splitFirst&&index===0?['-top','-bottom']:[''])nodes.push(`<video id="shot-${index}-${n}${slot}" class="clip shot${slot?' shot-b-roll shot-split':''}" data-start="${start+offset}" data-duration="${duration}" data-media-start="${segment.startSeconds}" src="${mediaUrl(member.relativePath)}"></video>`);offset+=duration;
  }
  if(render.adjustments.captionsEnabled&&frozen.subtitlesEnabled)for(const [n,cue] of captionCuesForShot(frozen.preparationContract.captions,offset*1000).entries())nodes.push(`<div id="caption-${index}-${n}" class="clip caption" data-start="${start+cue.startMs/1000}" data-duration="${(cue.endMs-cue.startMs)/1000}"><span>${escape(cue.text)}</span></div>`);
  if(frozen.audioMode==='tts'){const voice=render.members.find(m=>m.memberKey===`narration:${shot.id}`)!;nodes.push(`<audio id="audio-${narrationIndex++}" data-start="${start}" data-duration="${voice.durationSeconds}" data-volume="1" src="${mediaUrl(voice.relativePath)}"></audio>`);voice.startSeconds=0;}
  if(frozen.audioMode==='source')nodes.push(`<audio id="source-audio-${index}-0" data-start="${start}" data-duration="${offset}" data-volume="1" src="${mediaUrl(member.relativePath)}"></audio>`);
  start+=offset;
 }
 const snake=(v:unknown):unknown=>Array.isArray(v)?v.map(snake):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),k==='composition'?value:snake(value)])):v;
 for(const frozen of render.confirmedShots){frozen.clipSegments??=frozen.preparationContract.clipSegments;const member=render.members.find(m=>m.memberKey===`shot:${frozen.shotId}`)!;member.clipSegments??=frozen.clipSegments;}
 const raw=snake(render) as any;raw.storyboard=render.storyboard;for(const shot of raw.confirmed_shots){delete shot.preparation_contract;delete shot.composition;}for(const m of raw.members){delete m.preparation_contract;delete m.composition;}
 return{snapshot:{capability:'review_rendering',review_render:raw},html:`<!doctype html><html><body><div id="root" data-composition-id="review-render-v1" data-duration="${start}" data-width="${render.adjustments.width}" data-height="${render.adjustments.height}">${nodes.join('')}</div></body></html>`};
}
