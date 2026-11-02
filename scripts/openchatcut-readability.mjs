import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Theme colors stay owned by the SDK. Only text inks that fail AA are moved
// toward the skin's foreground; colored track labels get their own ink.
export const nativeReadabilityRuntime = `
const rgb=hex=>hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16));
const luminance=hex=>rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const score=(ink,surfaces)=>Math.min(...surfaces.map(bg=>ratio(ink,bg)));
function readable(ink,surfaces,strong){
 if(score(ink,surfaces)>=4.6)return ink;
 const a=rgb(ink),b=rgb(strong);
 for(let step=1;step<=20;step++){
  const mixed='#'+a.map((v,i)=>Math.round(v+(b[i]-v)*step/20).toString(16).padStart(2,'0')).join('');
  if(score(mixed,surfaces)>=4.6)return mixed;
 }
 return strong;
}
function onFill(original,surfaces){return [original,'#000000','#ffffff'].reduce((best,ink)=>score(ink,surfaces)>score(best,surfaces)?ink:best,original)}
export function readableNativeTokens(tokens){
 const surfaces=[tokens.bg,tokens.panel,tokens.panelAlt,tokens.inset,tokens.hover];
 return {...tokens,textDim:readable(tokens.textDim,surfaces,tokens.textStrong),textMuted:readable(tokens.textMuted,surfaces,tokens.textStrong),
  onAccent:score(tokens.onAccent,[tokens.accent,tokens.accentDeep])>=4.6?tokens.onAccent:onFill(tokens.onAccent,[tokens.accent,tokens.accentDeep]),
  onTrackVideo:onFill(tokens.onAccent,[tokens.trackVideo]),onTrackAudio:onFill(tokens.onAccent,[tokens.trackAudioA1]),onTrackCaption:onFill(tokens.onAccent,[tokens.trackCaption])};
}
`;

export const nativeReadabilityCss = `
/* Host adaptation for OpenChatCut 0.2.17: independent track inks and readable overlays. */
.cc-preview-header{overflow-x:auto;white-space:nowrap;gap:8px}
.cc-preview-header>*,.cc-preview-header-actions>*{flex-shrink:0}
.cc-inspector{container:lc-inspector / inline-size}
@media(max-width:1000px){
 html[data-lc-host-tools] .cc-preview-workspace>.cc-inspector{width:min(260px,100%);flex:0 0 min(260px,100%)}
}
@container lc-inspector (max-width:280px){
 .cc-insp-control-line{flex-wrap:wrap}
 .cc-insp-control-line>div:first-child{flex-basis:100%!important}
 .cc-insp-kf{margin-left:auto}
 .cc-insp-row{grid-template-columns:44px minmax(40px,1fr) 76px;gap:6px}
}
.cc-ruler-head span{color:var(--cc-text-muted)}
.cc-track-name-custom{opacity:1}
.cc-insp-scope{color:var(--cc-text)}
.cc-clip-duration{background:var(--cc-bg)}
.cc-clip-label,.cc-clip-label.audio{color:var(--cc-text-strong);background:var(--cc-bg);padding:1px 3px;border-radius:2px;text-shadow:none}
.cc-caption-track-cue{background:var(--cc-track-caption);color:var(--cc-on-track-caption)}
`;

function replace(code,anchor,value){
 if(!code.includes(anchor))throw Error('当前 Studio 缺少已验证的文字可读性接点。');
 return code.replace(anchor,value);
}
export function nativeReadabilityPlugin(root){
 if(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version!=='0.2.17')throw Error('Studio 文字适配仅验证了 OpenChatCut 0.2.17。');
 const virtual='\0loop-control-readability';
 return{name:'loop-control-native-readability',enforce:'pre',
  resolveId(id){if(id==='virtual:loop-control-readability')return virtual;},
  load(id){if(id===virtual)return nativeReadabilityRuntime;},
  transform(code,id){const path=id.split('?')[0];
   if(path.endsWith('/src/skins.ts'))return{code:"import {readableNativeTokens} from 'virtual:loop-control-readability';\n"+replace(code,'Object.entries(tokens)','Object.entries(readableNativeTokens(tokens))'),map:null};
   if(path.endsWith('/src/components/timeline/TrackHead.tsx'))return{code:replace(code,'style={{ background: tagColor }}',"style={{ background: tagColor, color: kind === 'video' ? 'var(--cc-on-track-video)' : kind === 'audio' ? 'var(--cc-on-track-audio)' : 'var(--cc-on-track-caption)' }}"),map:null};
   if(path.endsWith('/src/index.css')){if(!code.includes('.cc-inspector {')||!code.includes('.cc-track-name {'))throw Error('当前 Studio 缺少已验证的紧凑布局接点。');return{code:code+'\n'+nativeReadabilityCss,map:null};}
  }};
}
