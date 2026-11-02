import {useEffect,type RefObject} from 'react';

/** Release host media on replacement and pause when its page or preview leaves view. */
export function useMediaLifecycle(media:RefObject<HTMLMediaElement|null>,identity:string){
 useEffect(()=>{const element=media.current;if(!element)return;
  const pause=()=>{if(!element.paused)element.pause();};
  const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)pause();});observer?.observe(element.closest('.app-audio-player')??element);
  return()=>{document.removeEventListener('visibilitychange',visibility);observer?.disconnect();pause();element.removeAttribute('src');if(element.currentSrc)element.load();};
 },[media,identity]);
}
