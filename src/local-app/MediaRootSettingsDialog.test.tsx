import {cleanup,render,screen,waitFor,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences} from '../preferences/preferences';
import {localRequest} from './client';
vi.mock('./client',()=>({localRequest:vi.fn()}));
afterEach(()=>{cleanup();vi.mocked(localRequest).mockReset();});
const manifest={sourceBinding:{path:'/test/old'},targetBinding:{path:'/test/new'},accounts:[{id:'account',name:'测试账号'}],episodes:[{id:'one',title:'第一期'},{id:'two',title:'第二期'}],fileCount:2,directoryCount:3,totalBytes:1572864,space:{freeBytes:3221225472,reserveBytes:1048576,requiredBytes:2621440},canExecute:true,conflicts:[],blockers:[]};
const root={path:'/test/old',canInitialize:false,status:'ready',migration:{id:'old',status:'completed',manifest}};
const props={preferences:defaultOwnerPreferences,page:'personal' as const,loading:false,saving:false,unavailable:false,error:'',onReload:vi.fn(),onSave:vi.fn(),onClose:vi.fn(),csrf:'synthetic'};
it('embeds storage in personal preferences, omits old migration details, and shows active progress then completion',async()=>{
 const commands:string[]=[];let state:any=root,finish!:(value:unknown)=>void;
 vi.mocked(localRequest).mockImplementation(async(_path,init)=>{
  if(!init?.body)return state;
  const body=JSON.parse(String(init.body));commands.push(body.command);
  if(body.command==='choose')return {path:'/test/new'};
  if(body.command==='planMigration'){state={...root,migration:{id:'plan',status:'planned',manifest}};return state.migration;}
  if(body.command==='executeMigration'){state={...state,migration:{...state.migration,status:'copying',progress:{copiedFiles:1,copiedBytes:100}}};return new Promise(resolve=>{finish=resolve;});}
  return {};
 });
 const user=userEvent.setup();render(<OwnerPreferencesDialog {...props}/>);
 await screen.findByText('/test/old');expect(screen.getAllByRole('dialog')).toHaveLength(1);expect(screen.getByRole('dialog',{name:'个人偏好'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/复制/})).toBeNull();expect(screen.queryByText('迁移完成')).toBeNull();expect(screen.queryByText('迁移范围')).toBeNull();expect(screen.queryByText(/盘点时空间|保留原位置/)).toBeNull();
 await user.click(screen.getByRole('button',{name:'更换存储位置'}));await screen.findByRole('textbox',{name:'新位置'});await user.click(screen.getByRole('button',{name:'选择文件夹'}));
 await user.click(screen.getByRole('button',{name:'检查迁移计划'}));await screen.findByRole('button',{name:'开始迁移'});await user.click(screen.getByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'}));await user.click(screen.getByRole('button',{name:'开始迁移'}));
 await screen.findByRole('progressbar',{name:'文件复制进度'});expect(screen.getByText('正在迁移')).toBeTruthy();expect(screen.getByRole('button',{name:'保存偏好'}).getAttribute('type')).toBe('submit');
 state={...root,path:'/test/new',migration:{id:'plan',status:'completed',manifest}};
 await act(async()=>finish({status:'completed'}));await screen.findByText('媒体根迁移完成，服务已使用新位置。');
 expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.queryByLabelText('已保存的迁移计划')).toBeNull();expect(commands).toEqual(['choose','planMigration','executeMigration']);
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'新位置'})).toBeNull());
});

it('retries storage reads locally without replacing a personal preference draft or its saved feedback',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true);
 vi.mocked(localRequest).mockRejectedValueOnce(new Error('存储暂时无法读取')).mockResolvedValue(root);
 render(<OwnerPreferencesDialog {...props} onSave={save}/>);
 await screen.findByText('存储暂时无法读取');
 await user.type(screen.getByRole('textbox',{name:'显示名称'}),'个人草稿');
 await user.click(screen.getByRole('button',{name:'重新读取存储位置'}));
 await screen.findByText('/test/old');
 expect((screen.getByRole('textbox',{name:'显示名称'}) as HTMLInputElement).value).toBe('个人草稿');
 expect(screen.getByText('未保存')).toBeTruthy();expect(save).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByText('已保存');
 await user.click(screen.getByRole('button',{name:'更换存储位置'}));
 expect(screen.getByText('已保存')).toBeTruthy();
});

it('checks a readable migration scope before explicit confirmation and invalidates a changed destination',async()=>{
 const commands:string[]=[],user=userEvent.setup();
 vi.mocked(localRequest).mockImplementation(async(_path,init)=>{
  if(!init?.body)return root;const body=JSON.parse(String(init.body));commands.push(body.command);
  return {id:'plan',status:'planned',manifest};
 });
 render(<OwnerPreferencesDialog {...props}/>);await screen.findByText('/test/old');
 await user.click(screen.getByRole('button',{name:'更换存储位置'}));
 const input=screen.getByRole('textbox',{name:'新位置'});await user.clear(input);await user.type(input,'/test/new');
 await user.click(screen.getByRole('button',{name:'检查迁移计划'}));
 await screen.findByText('1 个账号 · 2 个生产单 · 2 个文件 · 1.5 MB');
 expect(screen.getByText('3 GB')).toBeTruthy();expect(screen.getByText('2.5 MB')).toBeTruthy();
 expect(screen.getByText('1 MB')).toBeTruthy();expect(commands).toEqual(['planMigration']);
 const start=screen.getByRole('button',{name:'开始迁移'}) as HTMLButtonElement;expect(start.disabled).toBe(true);
 await user.click(screen.getByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'}));expect(start.disabled).toBe(false);
 await user.type(input,'-changed');expect(start.disabled).toBe(true);
 expect(screen.getByText('目标位置已更改，请重新检查迁移计划。')).toBeTruthy();
 await user.clear(input);await user.type(input,'/test/new');expect(start.disabled).toBe(true);
 expect(commands).toEqual(['planMigration']);
});
it('distinguishes a finished copy from migration completion and resumes the same interrupted plan',async()=>{
 const user=userEvent.setup(),commands:any[]=[];
 let state:any={...root,executing:false,migration:{id:'interrupted',status:'copying',manifest,progress:{copiedFiles:2,copiedBytes:1572864}}};
 vi.mocked(localRequest).mockImplementation(async(_path,init)=>{
  if(!init?.body)return state;const body=JSON.parse(String(init.body));commands.push(body);
  state={...state,migration:{...state.migration,status:'completed'},path:'/test/new'};return {status:'completed'};
 });
 render(<OwnerPreferencesDialog {...props}/>);await screen.findByText('迁移已中断');
 expect(screen.getByText('2 / 2 个文件 · 1.5 MB / 1.5 MB')).toBeTruthy();
 expect(screen.getByText('复制完成，尚需验证文件并切换位置。')).toBeTruthy();
 expect(screen.queryByText('媒体根迁移完成，服务已使用新位置。')).toBeNull();
 await user.click(screen.getByRole('button',{name:'继续迁移'}));
 await screen.findByText('媒体根迁移完成，服务已使用新位置。');
 expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({command:'executeMigration',migrationId:'interrupted'});
});
it('keeps preference and migration pending and failure feedback independent',async()=>{
 const user=userEvent.setup();let finishPlan!:(value:unknown)=>void,finishSave!:(value:boolean)=>void;
 const save=vi.fn(()=>new Promise<boolean>(resolve=>{finishSave=resolve;}));
 vi.mocked(localRequest).mockImplementation(async(_path,init)=>{
  if(!init?.body)return root;return new Promise(resolve=>{finishPlan=resolve;});
 });
 render(<OwnerPreferencesDialog {...props} onSave={save}/>);await screen.findByText('/test/old');
 await user.type(screen.getByRole('textbox',{name:'显示名称'}),'偏好草稿');
 await user.click(screen.getByRole('button',{name:'更换存储位置'}));await user.clear(screen.getByRole('textbox',{name:'新位置'}));await user.type(screen.getByRole('textbox',{name:'新位置'}),'/test/new');
 await user.click(screen.getByRole('button',{name:'检查迁移计划'}));
 expect((screen.getByRole('button',{name:'保存偏好'}) as HTMLButtonElement).disabled).toBe(false);
 await user.click(screen.getByRole('button',{name:'保存偏好'}));expect(screen.getByText('保存中…',{selector:'footer>[role="status"]'})).toBeTruthy();
 await act(async()=>finishPlan({id:'plan',status:'planned',manifest}));
 expect(screen.getByText('保存中…',{selector:'footer>[role="status"]'})).toBeTruthy();expect(screen.getByText('迁移计划已检查，尚未开始迁移。')).toBeTruthy();
 await act(async()=>finishSave(false));expect(screen.getByText('保存失败，修改尚未保存')).toBeTruthy();
 expect(screen.getByText('迁移计划已检查，尚未开始迁移。')).toBeTruthy();expect((screen.getByRole('textbox',{name:'显示名称'}) as HTMLInputElement).value).toBe('偏好草稿');
});
it('does not release a pending migration command when its progress read is retried',async()=>{
 const user=userEvent.setup();let executing=false,retry=false,finish!:(value:unknown)=>void;
 const planned={...root,migration:{id:'plan',status:'planned',manifest}};
 vi.mocked(localRequest).mockImplementation(async(_path,init)=>{
  if(!init?.body){if(executing&&!retry)throw new Error('进度暂时无法读取');return planned;}
  return new Promise(resolve=>{finish=resolve;});
 });
 render(<OwnerPreferencesDialog {...props}/>);await screen.findByText('/test/new');
 await user.click(screen.getByRole('checkbox',{name:'确认迁移完成后使用新位置，原文件保留'}));executing=true;
 await user.click(screen.getByRole('button',{name:'开始迁移'}));await screen.findByText('进度暂时无法读取');retry=true;
 await user.click(screen.getByRole('button',{name:'重新读取存储位置'}));await waitFor(()=>expect(screen.queryByText('进度暂时无法读取')).toBeNull());
 expect(screen.queryByRole('button',{name:'开始迁移'})).toBeNull();expect(screen.getByText('正在迁移')).toBeTruthy();
 await act(async()=>finish({status:'completed'}));
});
it('rechecks an unavailable registered storage location in place',async()=>{
 vi.mocked(localRequest).mockResolvedValueOnce({...root,status:'unavailable',reason:'存储卷暂时不可用'}).mockResolvedValue(root);
 render(<OwnerPreferencesDialog {...props}/>);await screen.findByText('存储卷暂时不可用');
 await userEvent.setup().click(screen.getByRole('button',{name:'重新读取存储位置'}));
 await waitFor(()=>expect(screen.queryByText('存储卷暂时不可用')).toBeNull());expect(screen.getByText('/test/old')).toBeTruthy();
});
