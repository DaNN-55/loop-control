import type {OpenChatCutProject} from '../worker/openchatcutProject.js';

/** Coverage follows the rendered sequence window; audio never fills a visual gap. */
export function workspaceVisualGaps(project:OpenChatCutProject){
 const timelines=new Map(project.timelines.map(t=>[t.id,t])),intervals:Array<[number,number]>=[];
 const root=timelines.get(project.activeTimelineId);if(!root)throw Error('当前时间线不存在。');
 const duration=Math.max(0,...root.items.map(i=>(Number(i.startFrame)+Number(i.durationInFrames))/root.fps));
 let nodes=0;
 function visit(id:string,from:number,to:number,offset:number,speed:number,stack:Set<string>){
  if(stack.has(id)||stack.size>32||++nodes>4096)throw Error('嵌套序列超出画面检查范围。');
  const timeline=timelines.get(id);if(!timeline)throw Error('已用嵌套序列不存在。');stack=new Set(stack).add(id);
  for(const item of timeline.items){
   const track=timeline.tracks[String(item.track)] as {hidden?:boolean;visible?:boolean}|undefined;
   if(item.hidden===true||item.visible===false||track?.hidden===true||track?.visible===false||Number(item.opacity??1)===0)continue;
   const start=Number(item.startFrame)/timeline.fps,end=start+Number(item.durationInFrames)/timeline.fps,a=Math.max(from,start),b=Math.min(to,end);
   if(b<=a)continue;
   if(item.kind==='sequence'){
    const child=timelines.get(String(item.timelineId));if(!child)throw Error('已用嵌套序列不存在。');
    const rate=Number(item.playbackRate??1),source=Number(item.srcInFrame??0)/child.fps;
    if(!(rate>0))throw Error('嵌套序列播放速度无效。');
    visit(child.id,source+(a-start)*rate,source+(b-start)*rate,offset+(a-from)/speed,speed*rate,stack);
   }else if(['video','image','solid','text','motion-graphic'].includes(String(item.kind)))intervals.push([offset+(a-from)/speed,offset+(b-from)/speed]);
  }
 }
 visit(root.id,0,duration,0,1,new Set());
 const gaps:Array<{startSeconds:number;endSeconds:number}>=[];let end=0;
 for(const [a,b] of intervals.sort((a,b)=>a[0]-b[0])){if(a>end+0.001/root.fps)gaps.push({startSeconds:end,endSeconds:a});end=Math.max(end,b);}
 if(duration>end+0.001/root.fps)gaps.push({startSeconds:end,endSeconds:duration});
 return gaps;
}
