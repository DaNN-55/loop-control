/** Monotone native volume automation has a bounded, exact positivity test.
 * Exotic overshooting curves and transcript edits remain explicitly unresolved.
 */
export function nativeSoundWindowAudibility(item:Record<string,unknown>,lo:number,hi:number):'audible'|'silent'|'unknown'{
 const start=Number(item.startFrame),first=Math.max(Math.floor(lo-start),Number(item.fadeInFrames??0)>0?1:0),last=Math.ceil(hi-start)-1;if(first>last)return'silent';
 const frames=(item.keyframes as {volume?:Array<{frame:number;value:number;easing?:unknown}>}|undefined)?.volume;
 if(!frames?.length)return Number(item.volume??1)>0?'audible':'silent';
 if(frames.some((k,i)=>!Number.isFinite(k.frame)||!Number.isFinite(k.value)||k.value<0||k.value>2||i>0&&k.frame<=frames[i-1].frame||k.easing!==undefined&&!['linear','easeIn','easeOut','easeInOut'].includes(String(k.easing))&&!(Array.isArray(k.easing)&&k.easing.length===4&&k.easing.every(n=>typeof n==='number'&&n>=0&&n<=1))))return'unknown';
 const positive=(frame:number)=>{
  if(frame<=frames[0].frame)return frames[0].value>0;
  if(frame>=frames.at(-1)!.frame)return frames.at(-1)!.value>0;
  for(let i=1;i<frames.length;i++)if(frame<=frames[i].frame)return frame===frames[i].frame?frames[i].value>0:frames[i-1].value>0||frames[i].value>0;
  return false;
 };
 return positive(first)||positive(last)||frames.some(k=>k.frame>=first&&k.frame<=last&&k.value>0)?'audible':'silent';
}

