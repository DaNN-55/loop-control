import {scriptStudioText,type ScriptStudioPlan} from '../scriptStudio.js';
import {parseProductionScript} from '../reviews/productionScript.js';
import type {ImportedShot} from './episodeBatchImportTypes.js';

export function buildImportedScriptStudioPlan(imported:{shots:ImportedShot[];sourceText:string},title:string):ScriptStudioPlan{
 const shots:ScriptStudioPlan['shots']=imported.shots.map(shot=>{
  const caption=shot.caption.trim()?shot.caption:null;
  return {
   title:'镜头 '+shot.sequence,durationSeconds:shot.durationSeconds,narration:shot.narration.trim()?shot.narration:'',subtitle:caption,
   visual:shot.visual,videoPrompt:shot.videoPrompt,camera:'',visualSource:'unassigned',
   settings:[
    {field:'口播启用',value:shot.narration.trim()?'开启':'关闭'},
    {field:'字幕',value:caption?'开启':'关闭'},
    ...(caption?[{field:'字幕正文模式',value:'independent'}]:[]),
   ],
  };
 });
 // Explicit shot timings drive production. The requested total remains on the original draft.
 const durationSeconds=shots.reduce((sum,shot)=>sum+Math.round(shot.durationSeconds*100),0)/100;
 return {title,durationSeconds,summary:'',sourceUse:imported.sourceText.trim()?'Excel 原稿与分镜':'Excel 分镜',settings:[],shots,changes:[],warnings:[],canProceed:true,
  narrationEnabled:shots.some(shot=>!!shot.narration),captionsEnabled:shots.some(shot=>shot.subtitle!==null)};
}

export function validateImportedScriptStudioPlan(plan:ScriptStudioPlan){
 if(plan.durationSeconds>3600)throw Error('分镜总时长不能超过 3600 秒。');
 const canonical=scriptStudioText(plan);
 if(canonical.length>200000)throw Error('分镜文字超过制作上限，请精简分镜。');
 parseProductionScript(canonical);
 return plan;
}
