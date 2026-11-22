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

it('puts media before the stage, removes the excerpt and keeps only major parameters',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.includes('script-studio?')?{sourceText:'# 标题\n## 制作设置\n- 画幅：9:16\n- 字幕：开启\n## 正文\n清晨的光落在窗边。'}:path.endsWith('/workspace')?{workspace:{scriptRevisionId:'script',captions:[{contract:{enabled:false}}]}}:{sections:{artifacts:[{id:'cover',artifact_type:'cover',relative_path:'cover.png',sha256:'a'.repeat(64),created_at:'2026-11-22'}],materialRevisions:[]}})));
 const props=desktopProps(),app=render(<ProductionCatalog {...props}/>);
 const preview=screen.getByRole('complementary',{name:'生产单预览'});
 await within(preview).findByText('9:16（原稿）');
 const media=within(preview).getByRole('img');
 expect(media.compareDocumentPosition(within(preview).getByText('当前阶段'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(within(preview).queryByText('脚本摘要')).toBeNull();
 expect(within(preview).queryByText('清晨的光落在窗边。')).toBeNull();
 expect(app.container.querySelectorAll('.production-preview-parameters dt')).toHaveLength(3);
 expect(within(preview).getByText('关闭')).toBeTruthy();
 expect(app.container.querySelector('details.production-preview-parameters')).toBeNull();
 fireEvent.click(within(preview).getByRole('button',{name:'进入制作'}));expect(props.onSelectEpisode).toHaveBeenCalledWith('one');
});

it('explains unavailable series display and uses catalog counts across pages',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 const props=desktopProps(),app=render(<ProductionCatalog {...props} footerActions={<button>回收站</button>}/>);
 expect(app.container.querySelector('.episode-list-footer button')?.textContent).toBe('回收站');
 expect(screen.getByRole('button',{name:'显示'}).querySelector('svg')).toBeNull();
 await userEvent.click(screen.getByRole('button',{name:'显示'}));
 expect((await screen.findByRole('menuitemcheckbox',{name:'列表显示系列'})).getAttribute('aria-disabled')).toBe('true');
 expect(screen.getByText('当前列表暂无系列')).toBeTruthy();
 await userEvent.keyboard('{Escape}');
 app.rerender(<ProductionCatalog {...props} seriesEpisodeCounts={{unassigned:8,another:1}}/>);
 await userEvent.click(screen.getByRole('button',{name:'显示'}));
 expect((await screen.findByRole('menuitemcheckbox',{name:'列表显示系列'})).getAttribute('aria-disabled')).not.toBe('true');
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

function propsWithSeries():ComponentProps<typeof ProductionCatalog>{
 const props=desktopProps();
 const account={id:'a',name:'日照金山'} as typeof props.accounts[number];
 const series={id:'series',name:'人情礼物'} as typeof props.series[number];
 return {...props,accounts:[account],accountsById:new Map([['a',account]]),series:[series],seriesById:new Map([['series',series]]),collections:{one:{containerId:'container',seriesId:'series'}}};
}

it('shows only account context by default and omits it after choosing the account',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 const props=propsWithSeries();
 const app=render(<ProductionCatalog {...props}/>);
 expect(app.container.querySelector('.episode-name small')?.textContent).toBe('日照金山');
 app.rerender(<ProductionCatalog {...props} filter="a"/>);
 expect(app.container.querySelector('.episode-name small')).toBeNull();
 await act(async()=>{});
});

it('restores optional series information without showing empty series placeholders',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 const props=propsWithSeries();
 const app=render(<ProductionCatalog {...props}/>);
 await userEvent.click(screen.getByRole('button',{name:'显示'}));
 await userEvent.click(screen.getByRole('menuitemcheckbox',{name:'列表显示系列'}));
 await userEvent.keyboard('{Escape}');
 expect(app.container.querySelector('.episode-name small')?.textContent).toBe('日照金山 · 人情礼物');
 expect(localStorage.getItem('loop-control.catalog.series.v1')).toBe('shown');
 app.unmount();
 const restored=render(<ProductionCatalog {...props} filter="a"/>);
 expect(restored.container.querySelector('.episode-name small')?.textContent).toBe('人情礼物');
 restored.rerender(<ProductionCatalog {...props} filter="a" collections={{one:{containerId:'container',seriesId:null}}}/>);
 expect(restored.container.querySelector('.episode-name small')).toBeNull();
 await act(async()=>{});
});

it('previews ordinary cells and account text but enters production only from the title',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({sections:{artifacts:[],materialRevisions:[]},workspace:null})));
 const props=propsWithSeries();
 const other={...props.episodes[0],id:'two',title:'测试'};
 const app=render(<ProductionCatalog {...props} episodes={[props.episodes[0],other]}/>);
 const row=app.container.querySelector('[data-preview-id="two"]')!;
 await userEvent.click(row.querySelectorAll('td')[1]);
 expect(within(screen.getByRole('complementary',{name:'生产单预览'})).getByRole('heading',{name:'测试'})).toBeTruthy();
 expect(props.onSelectEpisode).not.toHaveBeenCalled();
 await userEvent.click(row.querySelector('small')!);
 expect(props.onSelectEpisode).not.toHaveBeenCalled();
 await userEvent.click(within(row as HTMLElement).getByRole('button',{name:/^测试$/}));
 expect(props.onSelectEpisode).toHaveBeenCalledExactlyOnceWith('two');
});
