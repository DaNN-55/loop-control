import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {StrictMode,type ComponentProps} from 'react';
import {ProductionCatalog} from './ProductionCatalog';

const showModal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal');
const close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
afterEach(()=>{
 cleanup();vi.unstubAllGlobals();localStorage.clear();
 for(const [key,descriptor] of [['showModal',showModal],['close',close]] as const){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,key,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}
});
it('returns mobile preview focus to its selected row even when pointer selection left body focused',async()=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;queueMicrotask(()=>this.dispatchEvent(new Event('close')));}});
 type Props=ComponentProps<typeof ProductionCatalog>;
 const episode={id:'one',account_id:'a',title:'山间日出',stage:'waiting_input',updated_at:'2026-11-19T00:00:00Z'} as Props['episodes'][number];
 const props:Props={accounts:[],accountsById:new Map(),artifacts:[],blueprintsById:new Map(),episodeVisibility:'active',episodes:[episode],filter:'全部账号',onEpisodeVisibilityChange:vi.fn(),onFilter:vi.fn(),onSeriesFilter:vi.fn(),onSelectEpisode:vi.fn(),series:[],seriesById:new Map(),seriesFilter:'全部系列',seriesVersionsById:new Map(),selectedEpisode:null};
 const app=render(<StrictMode><ProductionCatalog {...props}/></StrictMode>),row=app.container.querySelector<HTMLTableRowElement>('.episode-row')!;
 const focusRow=row.focus.bind(row);
 vi.spyOn(row,'focus').mockImplementation(()=>{if(!app.container.querySelector('dialog[open]'))focusRow();});
 expect(document.activeElement).toBe(document.body);fireEvent.click(row);
 await act(async()=>{});
 fireEvent(await screen.findByRole('dialog',{name:'生产单预览'}),new Event('cancel',{bubbles:true,cancelable:true}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(row);
});

function desktopProps():ComponentProps<typeof ProductionCatalog>{
 const episode={id:'one',account_id:'a',title:'山间日出',stage:'waiting_input',updated_at:'2026-11-19T00:00:00Z'} as ComponentProps<typeof ProductionCatalog>['episodes'][number];
 return {accounts:[],accountsById:new Map(),artifacts:[],blueprintsById:new Map(),episodeVisibility:'active',episodes:[episode],filter:'全部账号',onEpisodeVisibilityChange:vi.fn(),onFilter:vi.fn(),onSeriesFilter:vi.fn(),onSelectEpisode:vi.fn(),series:[],seriesById:new Map(),seriesFilter:'全部系列',seriesVersionsById:new Map(),selectedEpisode:null};
}

it('puts the episode and action before the readable script with original parameters collapsed',async()=>{
 const sourceText='# 标题\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n## 正文\n### 段落 01\n- 口播：清晨的光落在窗边。\n- 画面来源：图片';
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.includes('script-studio?')?{sourceText}:path.endsWith('/workspace')?{workspace:{scriptRevisionId:'script'}}:{sections:{artifacts:[],materialRevisions:[]}})));
 const props=desktopProps();
 const app=render(<ProductionCatalog {...props}/>);
 const preview=screen.getByRole('complementary',{name:'生产单预览'});
 await within(preview).findByText('清晨的光落在窗边。');
 const action=within(preview).getByRole('button',{name:'进入制作'});
 expect(action.compareDocumentPosition(within(preview).getByRole('heading',{name:'脚本摘要'}))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(app.container.querySelector('details.production-preview-parameters')?.hasAttribute('open')).toBe(false);
 fireEvent.click(action);expect(props.onSelectEpisode).toHaveBeenCalledWith('one');
 expect(within(preview).queryByText(/模板版本/)).toBeNull();
});

it('keeps statistics and the preview accessible from the display menu and persists preview changes',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 const app=render(<ProductionCatalog {...desktopProps()}/>);
 await userEvent.click(screen.getByRole('button',{name:'显示'}));
 const stats=await screen.findByRole('menuitemcheckbox',{name:'显示统计'});
 await userEvent.click(stats);
 expect(app.container.querySelector('[data-statistics=true]')).not.toBeNull();
 expect(localStorage.getItem('loop-control.catalog.statistics.v1')).toBe('shown');
 await userEvent.click(screen.getByRole('menuitemcheckbox',{name:'生产单预览'}));
 expect(screen.queryByRole('complementary',{name:'生产单预览'})).toBeNull();
 expect(localStorage.getItem('loop-control.catalog.preview.v1')).toBe('hidden');
 await userEvent.click(screen.getByRole('button',{name:'显示'}));
 await userEvent.click(screen.getByRole('menuitemcheckbox',{name:'生产单预览'}));
 expect(screen.getByRole('complementary',{name:'生产单预览'})).toBeTruthy();
});
