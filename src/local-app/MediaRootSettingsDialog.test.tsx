import {render,screen,waitFor,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {OwnerPreferencesDialog} from './OwnerPreferencesDialog';
import {defaultOwnerPreferences} from '../preferences/preferences';
import {localRequest} from './client';
vi.mock('./client',()=>({localRequest:vi.fn()}));
const manifest={targetBinding:{path:'/test/new'},fileCount:2,totalBytes:200,canExecute:true,conflicts:[],blockers:[]};
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
 await user.click(screen.getByRole('button',{name:'迁移'}));await user.click(await screen.findByRole('button',{name:'开始迁移'}));
 await screen.findByRole('progressbar',{name:'迁移进度'});expect(screen.getByText('正在迁移')).toBeTruthy();expect(screen.getByRole('button',{name:'保存偏好'}).getAttribute('type')).toBe('submit');
 state={...root,path:'/test/new',migration:{id:'plan',status:'completed',manifest}};
 await act(async()=>finish({status:'completed'}));await screen.findByText('媒体根迁移完成，服务已使用新位置。');
 expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.queryByLabelText('已保存的迁移计划')).toBeNull();expect(commands).toEqual(['choose','planMigration','executeMigration']);
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'新位置'})).toBeNull());
});
