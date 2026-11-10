import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkspaceGenerationModel} from './WorkspaceGenerationModel';
import {registeredAdapters} from '../worker/registeredAdapters';
import type {ProductionService} from '../connections/serviceCatalog';
const minimax={...registeredAdapters.productionChoices().find(c=>c.provider==='minimax')!,authenticationType:'api_key',connectionId:'connection-mini',status:'verified',unavailableReason:null,id:'mini',provider:'minimax',adapter:'minimax_video',capability:'video',mode:'generation',connectionVersionId:'mini-v',connectionName:'工作室 MiniMax',connectionVersion:4,executable:true,models:['MiniMax-H3','MiniMax-H3-Lite']};
const services=[minimax,{...minimax,id:'wan',provider:'bailian',adapter:'wan_video',connectionVersionId:'wan-v',connectionName:'百炼连接',connectionVersion:2,models:['wan2.6-i2v']} ] as ProductionService[];
const selection={capability:'video' as const,provider:'minimax',adapter:'minimax_video',connectionVersionId:'mini-v',model:'MiniMax-H3'};
afterEach(cleanup);
it('flattens models with local brand marks while preserving the exact selected ID',async()=>{
 const change=vi.fn();render(<WorkspaceGenerationModel compact kind="视频" services={services} selection={selection} onChange={change}/>);
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 expect(screen.queryByRole('group')).toBeNull();
 expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
 const selected=screen.getByRole('menuitemradio',{name:'MiniMax-H3'});
 expect(selected.getAttribute('aria-checked')).toBe('true');
 expect(selected.querySelector('img')?.getAttribute('src')).toBe('/brand/models/minimax-color.svg');
 expect(selected.querySelector('strong')?.title).toContain('工作室 MiniMax · v4');
 await userEvent.click(screen.getByRole('menuitemradio',{name:'MiniMax-H3-Lite'}));
 expect(change).toHaveBeenCalledWith('mini:MiniMax-H3-Lite');
 expect(screen.queryByRole('menu')).toBeNull();
});
it('filters flat options with model or connection search and renders a useful empty result',async()=>{
 render(<WorkspaceGenerationModel compact kind="视频" services={services} selection={selection} onChange={vi.fn()}/>);
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'筛选视频模型'}),{target:{value:'百炼连接'}});
 expect(screen.getByRole('menuitemradio',{name:'wan2.6-i2v'})).toBeTruthy();expect(screen.queryByRole('menuitemradio',{name:'MiniMax-H3'})).toBeNull();
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
