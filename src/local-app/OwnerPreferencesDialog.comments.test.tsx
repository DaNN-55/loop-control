import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {MediaRootSettingsDialog} from './MediaRootSettingsDialog';
import {defaultOwnerPreferences,parseOwnerPreferences} from '../preferences/preferences';
import {setUiLocale,useUiLocale} from '../i18n/ui';
const request=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>request(path,init)}));
afterEach(()=>{cleanup();request.mockReset();setUiLocale('zh-CN');});
const props={preferences:{...defaultOwnerPreferences,displayName:'保留中文名称'},page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',embedded:true,onReload:vi.fn(),onClose:vi.fn(),onSave:vi.fn(async()=>true)};
it('saves English through validated preferences without translating the owner name',async()=>{
 const user=userEvent.setup();function Host(){useUiLocale();const [preferences,setPreferences]=useState(props.preferences);return <OwnerPreferencesDialog {...props} preferences={preferences} onSave={async value=>{const saved=parseOwnerPreferences(value);setPreferences(saved);setUiLocale(saved.language);return true;}}/>;}
 render(<Host/>);const language=screen.getByRole('combobox',{name:'界面语言'});expect(language.parentElement?.querySelector('.dan-select-leading')).toBeNull();
 await user.selectOptions(language,'en-US');await user.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByRole('heading',{name:'Interface & notifications'});expect(screen.queryByRole('textbox',{name:'Display name'})).toBeNull();expect(screen.getByRole('combobox',{name:'Interface language'})).toHaveProperty('value','en-US');
});
it('shows appearance as one native radio group with icons and an explicit save',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true);render(<OwnerPreferencesDialog {...props} onSave={save}/>);
 const group=within(screen.getByRole('radiogroup',{name:'外观'}));
 expect(group.getByRole('radio',{name:'浅色'}).closest('label')?.querySelector('.lucide-sun')).toBeTruthy();
 expect(group.getByRole('radio',{name:'深色'}).closest('label')?.querySelector('.lucide-moon')).toBeTruthy();
 expect(group.getByRole('radio',{name:'跟随系统'}).closest('label')?.querySelector('.lucide-monitor')).toBeTruthy();
 await user.click(group.getByRole('radio',{name:'深色'}));expect(save).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(save).toHaveBeenCalledWith({...props.preferences,appearance:'dark'});
});
it('lets the embedded media directory be chosen and checked without starting a migration',async()=>{
 const root={path:'/test/media',canInitialize:false,status:'ready',migration:null},calls:Array<{command:string;path?:string}>=[];
 request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='log-storage')return {activeDirectory:'/test/logs',configuredDirectory:'/test/logs',defaultDirectory:'/test/logs',pending:false,warning:null};
  if(!init?.body)return root;const body=JSON.parse(String(init.body));calls.push(body);
  if(body.command==='choose')return {path:'/test/new-media'};
  return {id:'checked-plan',status:'planned',manifest:{sourceBinding:{path:root.path},targetBinding:{path:body.path},accounts:[],episodes:[],fileCount:0,totalBytes:0,space:{freeBytes:1000,reserveBytes:0,requiredBytes:0},canExecute:true,conflicts:[],blockers:[]}};
 });
 const user=userEvent.setup();render(<MediaRootSettingsDialog csrf="synthetic" onClose={vi.fn()} embedded/>);await screen.findByText('/test/media');await user.click(screen.getByRole('button',{name:'更换存储位置'}));const input=await screen.findByRole('textbox',{name:'素材保存目录'});expect(input).toHaveProperty('value','/test/media');
 await user.click(screen.getByRole('button',{name:'选择素材文件夹'}));await waitFor(()=>expect(input).toHaveProperty('value','/test/new-media'));await user.click(screen.getByRole('button',{name:'检查迁移计划'}));await screen.findByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'});
 expect(calls.map(value=>value.command)).toEqual(['choose','planMigration']);expect(calls[1].path).toBe('/test/new-media');expect(screen.getByRole('button',{name:'开始迁移'})).toHaveProperty('disabled',true);
});
