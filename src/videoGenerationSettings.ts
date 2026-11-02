export interface WanGenerationSettings {
 resolution:'720P'|'1080P';audio:boolean;promptExtend:boolean;shotType:'single'|'multi';watermark:boolean;negativePrompt:string;seed?:number;
}
export const wanSettingLabels:Record<keyof WanGenerationSettings,string>={resolution:'分辨率',audio:'视频声音',promptExtend:'提示词扩写',shotType:'镜头结构',watermark:'水印',seed:'随机种子',negativePrompt:'负面提示词'};
export const defaultWanSettings:WanGenerationSettings={resolution:'720P',audio:false,promptExtend:false,shotType:'single',watermark:false,negativePrompt:''};
export function isWanGenerationSettings(value:unknown):value is WanGenerationSettings {
 if(!value||typeof value!=='object')return false;const s=value as WanGenerationSettings;
 return ['720P','1080P'].includes(s.resolution)&&typeof s.audio==='boolean'&&typeof s.promptExtend==='boolean'&&typeof s.watermark==='boolean'&&['single','multi'].includes(s.shotType)&&(s.shotType!=='multi'||s.promptExtend)&&typeof s.negativePrompt==='string'&&s.negativePrompt.length<=500&&(s.seed===undefined||Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=2147483647);
}
export interface FirstFrameComposition {fit:'contain'|'cover';width:number;height:number}
