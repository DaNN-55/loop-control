import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {ProductionService} from '../connections/serviceCatalog';
import {WorkspaceAudioSourceOptions} from './WorkspaceAudioSourceOptions';
const services=[
 {id:'sound-a',provider:'freesound',adapter:'freesound_preview',label:'Freesound',connectionName:'声音 A',connectionVersion:2,executable:true},
 {id:'sound-b',provider:'freesound',adapter:'freesound_preview',label:'Freesound',connectionName:'声音 B',connectionVersion:3,executable:true},
 {id:'sound-disabled',provider:'freesound',adapter:'freesound_preview',label:'Freesound',connectionName:'未验证',connectionVersion:1,executable:false,unavailableReason:'连接未验证'},
] as ProductionService[];
afterEach(cleanup);
it('filters exact audio connections, closes on selection, and clears without choosing another connection',async()=>{
 const changed=vi.fn();
 function View(){const [value,setValue]=useState('');return <WorkspaceAudioSourceOptions services={services} value={value} onChange={id=>{changed(id);setValue(id);}}/>;}
 render(<View/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'筛选音频来源'}),{target:{value:'声音 B'}});
 expect(screen.queryByRole('menuitemradio',{name:/声音 A/})).toBeNull();
 fireEvent.click(screen.getByRole('menuitemradio',{name:/声音 B/}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'选择音频来源'})).toBeNull());
 expect(changed).toHaveBeenLastCalledWith('sound-b');
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 expect(screen.getByRole('menuitemradio',{name:/声音 B/}).getAttribute('aria-checked')).toBe('true');
 expect(screen.getByRole('menuitemradio',{name:/未验证/}).getAttribute('aria-disabled')).toBe('true');
 fireEvent.click(screen.getByRole('menuitemradio',{name:/未验证/}));expect(changed).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'清除来源选择'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'选择音频来源'})).toBeNull());expect(changed).toHaveBeenLastCalledWith('');
});
it('locks source choices and clearing when the current operation becomes busy',()=>{
 const change=vi.fn(),view=render(<WorkspaceAudioSourceOptions services={services} value="sound-a" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 view.rerender(<WorkspaceAudioSourceOptions services={services} value="sound-a" disabled onChange={change}/>);
 const choice=screen.getByRole('menuitemradio',{name:/声音 B/});
 expect(choice.getAttribute('aria-disabled')).toBe('true');
 expect(screen.getByRole('button',{name:'清除来源选择'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'清除来源选择'}));expect(change).not.toHaveBeenCalled();
});
it('identifies missing sources and searches with no matches without extra footer actions',()=>{
 const view=render(<WorkspaceAudioSourceOptions services={[]} value="" onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));expect(screen.getByRole('status').textContent).toBe('暂无可用音频连接');
 expect(screen.queryByRole('button',{name:'刷新服务'})).toBeNull();expect(screen.queryByRole('button',{name:'设为本期默认'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'关闭音频来源'}));
 view.rerender(<WorkspaceAudioSourceOptions services={services} value="" onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));fireEvent.change(screen.getByRole('searchbox',{name:'筛选音频来源'}),{target:{value:'不存在的来源'}});
 expect(screen.getByRole('status').textContent).toBe('没有匹配来源。');
});
it('shows the exact identity and unavailable reason for a single disabled source',()=>{
 render(<WorkspaceAudioSourceOptions services={[services[2]]} value="" onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'音频来源'}));
 const item=screen.getByRole('menuitemradio',{name:/Freesound/});
 expect(item.getAttribute('aria-disabled')).toBe('true');
 expect(screen.getByText('未验证 · v1 · 连接未验证').closest('[role="menuitemradio"]')).toBe(item);
});
