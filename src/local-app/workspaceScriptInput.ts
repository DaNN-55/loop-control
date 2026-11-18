import {mainScriptDiagnostic,plainScriptParagraphs} from '../reviews/mainScript.js';
import {parseProductionScript,segmentSettings} from '../reviews/productionScript.js';

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
- 模板版本：3
- 画幅：9:16
- 旁白音色：默认
- 旁白语言：zh-CN
- 旁白语速：1
- 背景音乐素材：默认
- 封面素材：默认
- 视频费用预留（分/镜头）：默认
- 字幕：开启
- 字幕正文模式：follow_tts
- 字幕样式：minimal
- 字幕位置：bottom-center
- 字幕安全区：title-safe
- 字幕最大行数：2
- 每行最大字数：14
- 旁白音量（dB）：0
- 音乐音量（dB）：-18
- 音乐闪避：medium
- 音效音量（dB）：-6
- 音效起点（秒）：0.75
- 音效时长（秒）：0.4
- 转场：硬切
- 转场时长（秒）：0.4
- 缩放：1
- 动画：慢推
- 动画幅度（%）：10

## 正文
### 段落 01
- 口播：雨停了，街角还亮着一盏灯。
- 画面来源：图片
- 画面提示：雨后街角，暖色路灯倒映在积水中。
- 镜头时长（秒）：5
- 构图：full
- 素材名称：默认
- 音效素材：默认
- 视频提示词：镜头缓缓前移，路灯在雨后积水中的倒影轻轻晃动。

### 段落 02
- 口播：沿着灯光往前走，路边的小店还在等人。
- 画面来源：图片
- 画面提示：街边小店的暖光透过玻璃，门前留着雨滴。
- 镜头时长（秒）：5
- 缩放：1.1
- 动画：拉远
- 动画幅度（%）：15
- 转场：叠化
- 字幕最大行数：1
- 每行最大字数：10
- 音效起点（秒）：0

### 段落 03
- 口播：今晚，就慢一点回家。
- 画面来源：图片
- 画面提示：街道尽头的背影，安静的夜色。
- 镜头时长（秒）：4
- 动画：无
- 转场：关闭
- 字幕：关闭

## 本期补充约束（可选）
- 制作备注：画面与视频提示词会预填，已有人工修改优先；口播、音乐和音效需在素材准备中选择并采用。
`;
