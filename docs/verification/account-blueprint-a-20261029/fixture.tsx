// Isolated browser verification of the real component. No real writes or provider requests.
import {createRoot} from 'react-dom/client';
import {useState, type ComponentProps} from 'react';
import {AccountWorkspace} from '../../../src/accounts/AccountWorkspace';
import {Button} from '../../../src/ui/dan-ui/components/base/buttons/button';
import type {Json} from '../../../src/lib/database.types';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';

const query = new URLSearchParams(location.search);
document.documentElement.dataset.interface = 'impeccable';
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
const long = query.has('long');
const now = '2026-10-29T02:00:00Z';
const account = {id:'fixture-account', name:long ? '用于检查超长账号名称在窄窗口中的显示与选择行为'.repeat(4) : '隔离演示账号', slug:'fixture-studio', timezone:'Asia/Shanghai', created_at:now, archived_at:null, current_blueprint_version_id:'fixture-blueprint'};
const harness = {account_id:account.id, capability:'storyboard_planning' as const, id:'fixture-harness', name:'分镜规划 v1', slug:'storyboard-planning-v1', version:1, is_active:true, instructions:'生成可执行镜头。', summary:'仅隔离验收。', content_hash:'a'.repeat(64), created_by:'fixture-owner', created_at:now};
const initialPolicy: Json = {positioning:'面向新用户，演示产品的日常使用。', asset_root:'/fixture/media/accounts/demo/', approval_gates:['storyboard','qc'], executors:{storyboard_planning:{provider:'codex', adapter:'codex', model:'gpt-5.6-luna', harness_id:harness.id, prompt_version:harness.slug}}, a_roll:{execution_path:'manual'}, b_roll:{execution_path:'manual'}, soundtrack:{execution_path:'manual'}};
const calls: unknown[] = [];
Object.assign(window, {fixtureCalls:calls});
window.fetch = async (input, init) => {
  const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({url, body});
  if (url.endsWith('/session')) return Response.json({csrfToken:'fixture-only'});
  if (body?.command === 'chooseAssetDirectory') return Response.json({assetRoot:'/fixture/chosen-directory'});
  if (body?.command === 'openAssetDirectory') return Response.json({opened:true});
  throw Error('隔离验收禁止真实请求：' + url);
};
function Fixture() {
  const [seriesItems, setSeriesItems] = useState(query.has('series') ? Array.from({length:25}, (_,i)=>({id:'fixture-series-'+(i+1),account_id:account.id,name:i===0?'新手入门':`系列 ${i+1}`,created_at:now})) : []);
  const [seriesVersions, setSeriesVersions] = useState(query.has('series') ? [2,1].map(version=>({id:'fixture-series-v'+version,account_id:account.id,series_id:'fixture-series-1',version,created_by:'fixture-owner',created_at:now,rules:{positioning:'帮助新用户掌握基本使用方法。',format:'9:16 竖屏，中文旁白',characters:'产品讲解员',locations:'桌面工作场景',visual_style:'清晰、写实',narrative_structure:'问题 → 演示 → 回顾',restrictions:'不虚构产品能力'} as Json})) : []);
  const [policy, setPolicy] = useState(initialPolicy);
  const [pending, setPending] = useState('');
  const [preflight, setPreflight] = useState<ComponentProps<typeof AccountWorkspace>['blueprintPreflight']>(null);
  return <div className="dan-ui product-ui impeccable-app" style={{padding:'24px', minHeight:'100vh', background:'var(--lc-bg)'}}><div style={{maxWidth:'1280px', margin:'0 auto 24px', display:'flex', justifyContent:'space-between', gap:'16px'}}><h1 style={{fontSize:'26px'}}>账号蓝图</h1><span style={{fontSize:'12px', color:'var(--lc-muted)'}}>隔离验收 · 无真实写入</span></div><AccountWorkspace account={account} accounts={[account, {...account,id:'fixture-other',name:'第二个演示账号'}]} blueprints={[{id:'fixture-blueprint',account_id:account.id,created_at:now,archived_at:null,is_active:true,is_snapshot:false,version:1,policy}]} series={seriesItems} seriesVersions={seriesVersions} onCreateSeries={async input=>{if(query.has('save-error'))throw Error('隔离验收：系列保存失败，请重试。');const id='fixture-created-series';setSeriesItems(current=>[...current,{id,account_id:account.id,name:input.name,created_at:now}]);setSeriesVersions(current=>[...current,{id:id+'-v1',account_id:account.id,series_id:id,version:1,created_by:'fixture-owner',created_at:now,rules:input.rules}]);}} onCreateSeriesVersion={async input=>{if(query.has('save-error'))throw Error('隔离验收：系列保存失败，请重试。');const version=Math.max(0,...seriesVersions.filter(item=>item.series_id===input.seriesId).map(item=>item.version))+1;setSeriesVersions(current=>[...current,{id:input.seriesId+'-v'+version,account_id:account.id,series_id:input.seriesId,version,created_by:'fixture-owner',created_at:now,rules:input.rules}]);}} promptVersions={[harness]} isPending={pending} blueprintPreflight={preflight} onSelectAccount={id=>calls.push({selectedAccount:id})} onRefresh={async()=>{calls.push({refresh:true});}} onRefreshBlueprintPreflight={async()=>{calls.push({check:true});setPreflight({version:'worker-preflight/v2',checks:query.has('blocked')?[{capability:'a_roll_generation',check:'command_availability',status:'failed',phase:'preflight',scope:'worker',action:'retry',reason:'隔离验收：运行命令尚未就绪。'}]:[]});}} onUpdateBlueprint={async next=>{calls.push({savedPolicy:next});setPending('blueprint');await Promise.resolve();setPending('');if(query.has('save-error'))return null;setPolicy(next);return {id:'fixture-blueprint',account_id:account.id,created_at:now,archived_at:null,is_active:true,is_snapshot:false,version:1,policy:next};}} actions={<Button size="sm" color="secondary" onClick={()=>calls.push({newAccount:true})}>新建账号</Button>} /></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
