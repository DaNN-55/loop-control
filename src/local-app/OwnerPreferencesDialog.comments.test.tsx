import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences,parseOwnerPreferences} from '../preferences/preferences';
import {setUiLocale,useUiLocale} from '../i18n/ui';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
afterEach(()=>{cleanup();request.mockReset();setUiLocale('zh-CN');});
const props={preferences:{...defaultOwnerPreferences,displayName:'保留中文名称'},page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',embedded:true,onReload:vi.fn(),onClose:vi.fn(),onSave:vi.fn(async()=>true)};
it('saves English through validated preferences without translating the owner name',async()=>{
 const user=userEvent.setup();function Host(){useUiLocale();const [preferences,setPreferences]=useState(props.preferences);return <OwnerPreferencesDialog {...props} preferences={preferences} onSave={async value=>{const saved=parseOwnerPreferences(value);setPreferences(saved);setUiLocale(saved.language);return true;}}/>;}
 render(<Host/>);const language=screen.getByRole('combobox',{name:'界面语言'});expect(language.parentElement?.querySelector('.dan-select-leading')).toBeNull();
 await user.selectOptions(language,'en-US');await user.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByRole('heading',{name:'Preferences'});expect(screen.getByRole('textbox',{name:'Display name'})).toHaveProperty('value','保留中文名称');expect(screen.getByRole('combobox',{name:'Interface language'})).toHaveProperty('value','en-US');
});
it('gives each appearance option its own semantic icon',async()=>{
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...props}/>);await user.click(screen.getByRole('combobox',{name:'外观'}));const list=within(await screen.findByRole('listbox',{name:'外观'}));
 expect(list.getByRole('option',{name:'浅色'}).querySelector('.lucide-sun')).toBeTruthy();expect(list.getByRole('option',{name:'深色'}).querySelector('.lucide-moon')).toBeTruthy();expect(list.getByRole('option',{name:'跟随系统'}).querySelector('.lucide-monitor')).toBeTruthy();
});
it('lets the embedded media directory be chosen and checked without starting a migration',async()=>{
 const root={path:'/test/media',canInitialize:false,status:'ready',migration:null},calls:Array<{command:string;path?:string}>=[];
 request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='log-storage')return {activeDirectory:'/test/logs',configuredDirectory:'/test/logs',defaultDirectory:'/test/logs',pending:false,warning:null};
  if(!init?.body)return root;const body=JSON.parse(String(init.body));calls.push(body);
  if(body.command==='choose')return {path:'/test/new-media'};
  return {id:'checked-plan',status:'planned',manifest:{sourceBinding:{path:root.path},targetBinding:{path:body.path},accounts:[],episodes:[],fileCount:0,totalBytes:0,space:{freeBytes:1000,reserveBytes:0,requiredBytes:0},canExecute:true,conflicts:[],blockers:[]}};
 });
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...props} csrf="synthetic"/>);await user.click(screen.getByRole('tab',{name:'存储位置'}));const input=await screen.findByRole('textbox',{name:'素材保存目录'});expect(input).toHaveProperty('value','/test/media');
 await user.click(screen.getByRole('button',{name:'选择素材文件夹'}));await waitFor(()=>expect(input).toHaveProperty('value','/test/new-media'));await user.click(screen.getByRole('button',{name:'检查迁移计划'}));await screen.findByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'});
 expect(calls.map(value=>value.command)).toEqual(['choose','planMigration']);expect(calls[1].path).toBe('/test/new-media');expect(screen.getByRole('button',{name:'开始迁移'})).toHaveProperty('disabled',true);
});
