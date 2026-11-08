import type {ProductionService} from '../connections/serviceCatalog';
import {imageSizePresets,imageQualityLabels,type ImageGenerationSettings} from '../imageGeneration';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';

export function WorkspaceImageSettings({settings,service,disabled,onChange}:{settings:ImageGenerationSettings;service?:ProductionService;disabled?:boolean;onChange:(settings:ImageGenerationSettings)=>void}){
 const preset=imageSizePresets.find(p=>p.standard===settings.size||p.high===settings.size)??imageSizePresets[0];
 const tier=settings.size===preset.high?'high':'standard';
 const allowed=(size:string)=>!service||!!service.constraints.sizes?.includes(size);
 const [width,height]=settings.size.split('x');
 const qualities=imageQualityLabels;
 return <>
  <div className="workspace-composer-choice-field"><span>画面比例</span><div className="workspace-composer-choices" role="group" aria-label="图片画面比例">{imageSizePresets.map(p=><button key={p.ratio} type="button" aria-pressed={preset===p} disabled={disabled||!allowed(p.standard)&&!allowed(p.high)} onClick={()=>onChange({...settings,size:allowed(p[tier])?p[tier]:allowed(p.standard)?p.standard:p.high})}>{p.ratio}</button>)}</div></div>
  <div className="workspace-composer-choice-field"><span>分辨率</span><div className="workspace-composer-choices" role="group" aria-label="图片实际像素">{(['standard','high'] as const).map(t=><button key={t} type="button" aria-pressed={tier===t} disabled={disabled||!allowed(preset[t])} onClick={()=>onChange({...settings,size:preset[t]})}>{t==='standard'?'标准':'高分辨率'}</button>)}</div></div>
  <div className="workspace-visual-fields"><label>宽度 W<input aria-label="图片宽度" readOnly value={width}/></label><label>高度 H<input aria-label="图片高度" readOnly value={height}/></label></div>
  <label>质量<NativeSelect size="sm" aria-label="图片质量" value={settings.quality} disabled={disabled} onChange={event=>onChange({...settings,quality:event.target.value as ImageGenerationSettings['quality']})}>{Object.entries(qualities).filter(([value])=>settings.quality===value||!service||service.constraints.qualities?.includes(value)).map(([value,label])=><option key={value} value={value} disabled={!!service&&!service.constraints.qualities?.includes(value)}>{label}</option>)}</NativeSelect></label>
 </>;
}

export function WorkspaceImageCount({settings,service,disabled,onChange}:{settings:ImageGenerationSettings;service?:ProductionService;disabled?:boolean;onChange:(settings:ImageGenerationSettings)=>void}){
 const counts=[...new Set([settings.count,...service?.constraints.counts??[1,2,4]])].sort((a,b)=>a-b);
 return <div className="workspace-composer-choices" role="group" aria-label="生成图片数量">{counts.map(count=><button type="button" key={count} aria-label={`生成 ${count} 张图片`} aria-pressed={settings.count===count} disabled={disabled||!!service&&!service.constraints.counts?.includes(count)} onClick={()=>onChange({...settings,count:count as ImageGenerationSettings['count']})}>{count}</button>)}</div>;
}
