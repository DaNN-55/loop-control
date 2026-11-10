import {mainScriptDiagnostic,plainScriptParagraphs} from '../reviews/mainScript';
import {parseProductionScript,segmentSettings} from '../reviews/productionScript';

/** Ordinary prose gains the required envelope; structured source remains byte-for-byte intact. */
export function workspaceScriptInput(source:string){
 const structured=/^\s*#{1,6}[ \t]+/m.test(source);
 const text=structured?source:`# 主脚本\n\n## 正文\n\n${source.trim()}\n`;
 const error=source.trim()?mainScriptDiagnostic(text):'请填写主脚本。';
 if(error)return{text,error,structured,shots:[]};
 const script=parseProductionScript(text);
 const shots=script?script.segments.map(segment=>({
  id:segment.id,subtitle:segmentSettings(script,segment).captionsEnabled===false?'字幕已关闭':segment.subtitle??segment.narration,
  visual:segment.visual||segment.videoPrompt,
 })):plainScriptParagraphs(text).map((paragraph,index)=>({id:`shot-${String(index+1).padStart(2,'0')}`,subtitle:paragraph,visual:''}));
 return{text,error:null,structured,shots};
}
export const workspaceScriptExample=`# 雨后的街角

## 制作设置
- 模板版本：2
- 画幅：9:16

## 正文
### 段落 01
- 口播：雨停了，街角还亮着一盏灯。
- 首帧素材：无
- 视频生成提示词：雨后街角，暖色路灯倒映在积水中，镜头缓慢推进。
`;
