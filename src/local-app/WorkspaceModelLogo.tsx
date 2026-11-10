import {Boxes} from 'lucide-react';
import './workspace-model-picker.css';

export function WorkspaceModelLogo({model='',provider}:{model?:string;provider?:string}){
 const name=model.toLowerCase();
 const brand=/claude/.test(name)?'claude-color':/gemini|veo/.test(name)?'gemini-color'
  :/^(wan|wanx)[-.\d]|万相/.test(name)?'wan':/qwen/.test(name)?'qwen-color':/hailuo/.test(name)?'hailuo-color':/minimax/.test(name)?'minimax-color'
  :/kling/.test(name)?'kling-color':/seedance|seedream|seed-tts|doubao/.test(name)?'doubao-color'
  :/^(gpt-|o[134](?:-|$)|dall-e|sora)/.test(name)?'openai'
  :provider==='volcengine_tts'?'doubao-color':provider==='google_tts'?'googlecloud-color':undefined;
 return brand?<img className="workspace-model-logo" data-monochrome={brand==='openai'||undefined} src={`/brand/models/${brand}.${brand==='wan'?'png':'svg'}`} alt="" aria-hidden="true" width={16} height={16}/>
  :<Boxes className="workspace-model-logo" size={16} aria-hidden="true"/>;
}
