import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {setUiLocale,useUiLocale} from '../i18n/ui';
import {ConnectionWorkspace,type ExternalConnection} from './ConnectionWorkspace';
import {ConnectionModelsDialog} from './ConnectionModelsDialog';
import {SystemStatusPanel,type LocalSystemStatusReport} from '../observability/SystemStatusPanel';
import {WorkerBlockerCard} from '../reviews/WorkerBlockerCard';
afterEach(()=>{cleanup();setUiLocale('zh-CN');});
it('switches product labels while preserving user names and capability values',()=>{
 const connection={id:'fixture',name:'语音',provider:'volcengine_tts',adapter:'volcengine_tts',current_version_id:'version',status:'verified',description:''} as ExternalConnection;
 function Host(){useUiLocale();return <ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>;}
 render(<Host/>);expect(screen.getByRole('table',{name:'已保存连接'})).toBeTruthy();
 act(()=>setUiLocale('en-US'));
 const table=screen.getByRole('table',{name:'Saved connections'});
 expect(within(table).getByRole('button',{name:'语音'})).toBeTruthy();
 expect(within(table).getByText('Verified')).toBeTruthy();
 expect(within(table).getByText('Doubao Speech')).toBeTruthy();
 const filter=screen.getByRole('combobox',{name:'Production capability'});
 expect(within(filter).getByRole('option',{name:'Speech'})).toHaveProperty('value','speech');
 act(()=>setUiLocale('zh-CN'));
 expect(screen.getByRole('table',{name:'已保存连接'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'语音'})).toBeTruthy();
});
it('translates model capability labels without changing model IDs or API filter values',async()=>{
 setUiLocale('en-US');const read=vi.fn().mockResolvedValue({connectionId:'fixture',versionId:'version',revision:'revision',enabledModels:['custom-model-中文'],models:[{id:'custom-model-中文',adapted:true,listed:true,capability:'图片'}],discovery:{supported:false,detail:'Provider supplied 原文',readAt:null}});
 render(<ConnectionModelsDialog connection={{id:'fixture',name:'保留名称'}} onClose={vi.fn()} onReadModels={read}/>);
 expect(await screen.findByRole('dialog',{name:'保留名称 model settings'})).toBeTruthy();
 expect(await screen.findByRole('checkbox',{name:'custom-model-中文'})).toBeTruthy();
 const filter=screen.getByRole('combobox',{name:'Model capability'});
 expect(within(filter).getByRole('option',{name:'Image'})).toHaveProperty('value','图片');
 fireEvent.change(filter,{target:{value:'图片'}});expect(screen.getByRole('checkbox',{name:'custom-model-中文'})).toBeTruthy();
 expect(read).toHaveBeenCalledWith('fixture');
});
it('keeps protocol dependency matching intact in English status rendering',async()=>{
 setUiLocale('en-US');
 const report:LocalSystemStatusReport={dependencies:[{name:'Supabase 迁移',state:'attention',detail:'migration raw 原文'},{name:'Codex CLI',state:'healthy',detail:'codex-cli 1.0.0'},{name:'Codex 模型 · gpt-test',state:'healthy',detail:'model raw 原文'}],mediaLibrary:{state:'healthy',detail:'mount raw 原文'},n8n:{state:'healthy',detail:'n8n raw 原文',lastHealthCheckAt:null},observedAt:'2026-11-11T08:00:00Z',viewTransport:{state:'healthy',detail:'database raw 原文'}};
 render(<SystemStatusPanel report={report} tasks={[]} episodes={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'System status: Needs attention'}));
 const dialog=await screen.findByRole('dialog',{name:'System status details'});
 expect(within(dialog).getByText('migration raw 原文')).toBeTruthy();
 expect(within(dialog).getByText('gpt-test')).toBeTruthy();
 expect(within(dialog).queryByText('Supabase migration status has not been loaded.')).toBeNull();
});
it('translates blocker guidance while preserving its original technical detail',()=>{
 setUiLocale('en-US');render(<WorkerBlockerCard blocker={{code:'provider_result_unknown',detail:'供应商原始错误：sample-id'}}/>);
 expect(screen.getByText('External request result unknown')).toBeTruthy();
 fireEvent.click(screen.getByText('Technical details'));
 expect(screen.getByText('供应商原始错误：sample-id')).toBeTruthy();
 expect(screen.getByText('Check the original request before deciding')).toBeTruthy();
});
