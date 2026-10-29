import React from 'react';
import {createRoot} from 'react-dom/client';
import {ScriptProductionPanel} from '../../../../src/local-app/ScriptProductionPanel';
import {productionScriptTemplate} from '../../../../src/reviews/productionScript';
import {resolveProductionPlan} from '../../../../src/reviews/productionPlan';
import '../../../../src/styles.css';
import '../../../../src/ui/impeccable/foundation.css';
import '../../../../src/ui/impeccable/production.css';
const mode=new URLSearchParams(location.search).get('mode'),episodeId='11111111-1111-4111-8111-111111111111';
const material=(n:number)=>({id:`22222222-2222-4222-8222-22222222222${n}`,episodeId,seriesId:null,name:`首帧-${n}.png`,alias:'填写已上传图片的素材名称',type:'image',purpose:'visual_reference',mime:'image/png',path:'test.png',sha256:String(n).repeat(64),size:10});
const plan=resolveProductionPlan(productionScriptTemplate,{},mode==='missing'?[]:mode==='ambiguous'?[material(1),material(2)]:[material(1)],episodeId,null);
let enabled=false;
window.fetch=async(url,init)=>{
 if(String(url).startsWith('/api/local/script-production?'))return Response.json({v2:mode!=='legacy',plan,inspection:plan,enabled,status:enabled?'已启用，等待当前审核或执行条件':'请核对素材与设置后保存制作计划'});
 if(String(url)==='/api/local/episode-commands'){
  if(mode==='error')return Response.json({error:'测试：执行配置需要补全'},{status:409});
  const body=JSON.parse(String(init?.body));enabled=body.command==='configureScriptProduction'&&body.data.enabled;
  return Response.json({enabled});
 }
 throw Error('Fixture blocks every other request');
};
createRoot(document.getElementById('root')!).render(<div className="dan-ui product-ui impeccable-app"><main className="episode-detail-drawer" style={{maxWidth:1100,margin:'32px auto',padding:24}}><p>隔离界面验证：所有请求由本页夹具处理。</p><ScriptProductionPanel episodeId={episodeId} onChanged={async()=>{}}/></main></div>);
