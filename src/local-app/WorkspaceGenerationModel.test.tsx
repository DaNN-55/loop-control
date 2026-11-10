import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {registeredAdapters} from '../worker/registeredAdapters';
import type {ProductionService} from '../connections/serviceCatalog';
const minimax={...registeredAdapters.productionChoices().find(c=>c.provider==='minimax')!,authenticationType:'api_key',connectionId:'connection-mini',status:'verified',unavailableReason:null,id:'mini',provider:'minimax',adapter:'minimax_video',capability:'video',mode:'generation',connectionVersionId:'mini-v',connectionName:'工作室 MiniMax',connectionVersion:4,executable:true,models:['MiniMax-H3','MiniMax-H3-Lite']};
const services=[minimax,{...minimax,id:'wan',provider:'bailian',adapter:'wan_video',connectionVersionId:'wan-v',connectionName:'百炼连接',connectionVersion:2,models:['wan2.6-i2v']} ] as ProductionService[];
const selection={capability:'video' as const,provider:'minimax',adapter:'minimax_video',connectionVersionId:'mini-v',model:'MiniMax-H3'};
afterEach(cleanup);
it('groups compact options by provider and displays a shared connection once, preserving the exact selected ID',async()=>{
 const change=vi.fn();render(<WorkspaceGenerationModel compact kind="视频" services={services} selection={selection} onChange={change}/>);
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 const group=screen.getByRole('group',{name:/^MiniMax/});
 expect(within(group).getAllByText('工作室 MiniMax · v4')).toHaveLength(1);
 expect(within(group).getAllByRole('menuitemradio')).toHaveLength(2);
 expect(within(group).getByRole('menuitemradio',{name:'MiniMax-H3'}).getAttribute('aria-checked')).toBe('true');
 await userEvent.click(within(group).getByRole('menuitemradio',{name:'MiniMax-H3-Lite'}));
 expect(change).toHaveBeenCalledWith('mini:MiniMax-H3-Lite');
 expect(screen.queryByRole('menu')).toBeNull();
});
it('filters provider groups with model or connection search and renders a useful empty result',async()=>{
 render(<WorkspaceGenerationModel compact kind="视频" services={services} selection={selection} onChange={vi.fn()}/>);
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'筛选视频模型'}),{target:{value:'百炼连接'}});
 expect(screen.getByRole('group',{name:/^阿里云百炼/})).toBeTruthy();expect(screen.queryByRole('group',{name:/^MiniMax/})).toBeNull();
 fireEvent.change(screen.getByRole('searchbox',{name:'筛选视频模型'}),{target:{value:'missing-model'}});
 expect(screen.getByRole('status').textContent).toBe('没有匹配模型。');
});
it('distinguishes two connections within a provider instead of merging identical model identities',async()=>{
 const duplicate={...minimax,id:'mini-b',connectionVersionId:'mini-v-b',connectionName:'备用连接',connectionVersion:1};const change=vi.fn();
 render(<WorkspaceGenerationModel compact kind="视频" services={[services[0],duplicate as ProductionService]} selection={selection} onChange={change}/>);
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 const options=screen.getAllByRole('menuitemradio',{name:/^MiniMax-H3-Lite/});expect(options).toHaveLength(2);
 expect(options[1].textContent).toContain('备用连接 · v1');
 await userEvent.click(options[1]);expect(change).toHaveBeenCalledWith('mini-b:MiniMax-H3-Lite');
});
