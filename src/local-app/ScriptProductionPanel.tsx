import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {localCommand,localRequest} from './client';
import type {ResolvedProductionPlan,MaterialResolution} from '../reviews/productionPlan';
interface ProductionView {v2:boolean;plan:ResolvedProductionPlan|null;inspection:ResolvedProductionPlan|null;enabled:boolean;status:string}
export function ScriptProductionPanel({episodeId,onChanged}:{episodeId:string;onChanged:()=>Promise<void>}){
 const [view,setView]=useState<ProductionView|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[pending,setPending]=useState(false),[choices,setChoices]=useState<Record<string,string>>({});
 useEffect(()=>{let active=true;async function read(){try{const next=await localRequest('script-production?episode='+encodeURIComponent(episodeId));if(active){setView(next);setLoadError('');}}catch(e){if(active)setLoadError(e instanceof Error?e.message:'制作计划读取失败。');}}
  setView(null);setChoices({});void read();const timer=setInterval(()=>void read(),4000);return()=>{active=false;clearInterval(timer);};
 },[episodeId]);
 async function save(enabled:boolean){
  setPending(true);setError('');
  try{await localCommand(enabled||!view?.enabled?'configureScriptProduction':'pauseScriptProduction',enabled||!view?.enabled?{episodeId,enabled,choices}:{episodeId},undefined,'episode-commands');setView(await localRequest('script-production?episode='+encodeURIComponent(episodeId)));await onChanged();}
  catch(e){setError(e instanceof Error?e.message:'制作计划保存失败。');}finally{setPending(false);}
 }
 if(!view?.v2&&!error&&!loadError)return null;
 const plan=view?.enabled?view.plan:view?.inspection??view?.plan;
 const references=plan?[plan.bgm,plan.cover,...plan.segments.flatMap(s=>[s.firstFrame,s.sfx])]:[];
 const unique=[...new Map(references.filter(r=>r.status!=='none').map(r=>[r.kind+':'+r.reference,r])).values()];
 const labels={image:'首帧',bgm:'背景音乐',sfx:'音效',cover:'封面'};
 const choice=(r:MaterialResolution)=>choices[r.kind+':'+r.reference]??r.material?.id??'';
 return <section className="review-section script-production-panel" aria-label="脚本制作计划">
  <header><h3>脚本制作计划</h3><p role="status">{view?.status}</p></header>
  {plan?<><p>{plan.segments.length} 段 · {plan.settings.aspectRatio??'默认画幅'} · 所有审核关卡保留</p>
   <Disclosure label="素材匹配" open={unique.some(r=>r.status!=='bound')}><div className="detail-card-body">
    {unique.length?<ul>{unique.map(r=><li key={r.kind+':'+r.reference}><strong>{labels[r.kind]} · {r.reference}</strong>{r.status==='bound'?<span>　已匹配：{r.material?.name}</span>:r.status==='missing'?<span>　待上传</span>:<label>　选择素材<NativeSelect size="sm" aria-label={`${r.reference} 匹配素材`} disabled={pending||view?.enabled} value={choice(r)} onChange={e=>setChoices(v=>({...v,[r.kind+':'+r.reference]:e.target.value}))}><option value="">请选择</option>{r.candidates.map(m=><option key={m.id} value={m.id}>{m.name} · {m.sha256.slice(0,8)}</option>)}</NativeSelect></label>}</li>)}</ul>:<p>未指定额外声音素材。</p>}
    <p className="muted-copy">在“准备生产材料”上传对应图片、音乐和音效；文件名可与脚本素材名称一致。唯一匹配自动绑定，缺失或歧义会暂停相关制作。</p>
   </div></Disclosure>
   <Disclosure label="逐段设置"><div className="detail-card-body"><table><thead><tr><th>段落</th><th>视频生成提示词</th><th>声音与字幕</th><th>衔接</th></tr></thead><tbody>{plan.segments.map(s=><tr key={s.id}><th>{s.id}</th><td>{s.videoPrompt}</td><td>{s.settings.voice??'默认音色'} · {s.settings.speakingRate??'默认语速'} · {s.settings.captionsEnabled===false?'关闭字幕':s.settings.captionMode==='independent'?'独立字幕':'跟随口播'} · 音效 {s.sfx.status==='none'?'无':s.sfx.reference}</td><td>{({cut:'硬切',fade:'基础淡化',studio:'交给 Studio'})[s.settings.transition??'cut']}</td></tr>)}</tbody></table></div></Disclosure>
   <div className="review-actions"><Button size="sm" color="secondary" isDisabled={pending||view?.enabled} onClick={()=>void save(false)}>保存制作计划</Button><Button size="sm" color={view?.enabled?'secondary':'primary'} isDisabled={pending} onClick={()=>void save(!view?.enabled)}>{pending?'处理中…':view?.enabled?'暂停自动继续':'确认并启用审核后继续'}</Button></div>
   <p className="muted-copy">启用后按已确认的执行配置与预算继续；到视觉、分镜、正文、同步预览和 QC 审核时等待你确认。视频费用预留：{plan.settings.videoReservationCents===undefined?'沿用默认':`每镜 ¥${(plan.settings.videoReservationCents/100).toFixed(2)}`}。</p>
  </>:null}{error||loadError?<p role="alert" className="form-error">{error||loadError}</p>:null}
 </section>;
}
