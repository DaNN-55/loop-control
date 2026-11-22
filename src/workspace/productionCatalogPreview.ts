export interface CatalogVideoMetadata {width:number;height:number;duration:number}
type Caption={contract:{enabled:boolean}};

/** Preview values never replace editing settings or infer captions from the original script. */
export function productionCatalogParameters(source:string,video?:CatalogVideoMetadata,captions?:Caption[]){
 const originalAspect=source.replace(/\r\n?/g,'\n').split(/^##[ \t]+制作设置[ \t]*$/m)[1]?.split(/^##[ \t]+/m)[0]?.match(/^\s*-\s*画幅[：:][ \t]*(9:16|16:9|1:1)[ \t]*$/m)?.[1];
 let aspect=originalAspect?`${originalAspect}（原稿）`:'未确认';
 if(video&&Number.isFinite(video.width)&&Number.isFinite(video.height)&&video.width>0&&video.height>0){
  const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
  const divisor=gcd(video.width,video.height);
  aspect=`${video.width/divisor}:${video.height/divisor}`;
 }
 const enabled=captions?.filter(item=>item.contract.enabled).length??0;
 return [
  {label:'画幅',value:aspect},
  {label:'时长',value:video&&Number.isFinite(video.duration)&&video.duration>0?`${Math.round(video.duration*10)/10} 秒`:'视频加载后显示'},
  {label:'字幕',value:!captions?.length?'未确认':enabled===0?'关闭':enabled===captions.length?'开启':'部分开启'},
 ];
}
