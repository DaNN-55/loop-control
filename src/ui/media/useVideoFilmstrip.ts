import {useEffect,useState} from 'react';

/** A bounded, cancellable six-frame strip for the one source currently being trimmed. */
export function useVideoFilmstrip(src:string|undefined,duration:number){
 const [strip,setStrip]=useState<{src:string;image:string}|null>(null);
 useEffect(()=>{
  if(!src||!Number.isFinite(duration)||duration<=0||typeof CanvasRenderingContext2D==='undefined')return;
  const video=document.createElement('video'),canvas=document.createElement('canvas');
  let active=true,cancelWait=()=>{};video.preload='metadata';video.muted=true;video.crossOrigin='anonymous';canvas.width=288;canvas.height=24;
  const context=canvas.getContext('2d');if(!context)return;
  const wait=(name:string)=>new Promise<void>((resolve,reject)=>{const done=()=>{clean();resolve();},fail=()=>{clean();reject(Error('Thumbnail unavailable'));},clean=()=>{clearTimeout(timer);video.removeEventListener(name,done);video.removeEventListener('error',fail);};const timer=setTimeout(fail,4000);video.addEventListener(name,done,{once:true});video.addEventListener('error',fail,{once:true});cancelWait=fail;});
  void(async()=>{try{
   const loaded=wait('loadedmetadata');video.src=src;await loaded;
   for(let index=0;active&&index<6;index++){
    const ready=wait('seeked');video.currentTime=Math.min(video.duration-.01,duration*(index+.5)/6);await ready;if(!active)return;
    const scale=Math.min(48/video.videoWidth,24/video.videoHeight),width=video.videoWidth*scale,height=video.videoHeight*scale;
    context.fillStyle='#dce4ef';context.fillRect(index*48,0,48,24);context.drawImage(video,index*48+(48-width)/2,(24-height)/2,width,height);
   }
   if(active)setStrip({src,image:canvas.toDataURL('image/jpeg',.7)});
  }catch{/* The labelled selection remains usable without thumbnails. */}})();
  return()=>{active=false;cancelWait();video.pause();video.removeAttribute('src');video.load();};
 },[src,duration]);
 return strip&&strip.src===src?strip.image:undefined;
}
