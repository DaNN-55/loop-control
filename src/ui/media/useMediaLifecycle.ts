import {useEffect,type RefObject} from 'react';

/** Release host media on replacement and pause when its page or preview leaves view. */
export function useMediaLifecycle(media:RefObject<HTMLMediaElement|null>,identity:string,src:string){
 useEffect(()=>{const element=media.current;if(!element)return;
  // StrictMode replays setup after cleanup on the same DOM node. Restore only
  // the source supplied by the current render, never a previous media address.
  if(src&&element.getAttribute('src')!==src)element.setAttribute('src',src);
  const pause=()=>{if(!element.paused)element.pause();};
  const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)pause();});observer?.observe(element.closest('.app-audio-player')??element);
  return()=>{document.removeEventListener('visibilitychange',visibility);observer?.disconnect();pause();element.removeAttribute('src');if(element.currentSrc)element.load();};
 },[media,identity,src]);
}
