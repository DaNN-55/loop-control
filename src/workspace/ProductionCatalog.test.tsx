import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
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
