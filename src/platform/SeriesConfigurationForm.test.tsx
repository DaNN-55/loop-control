import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>vi.restoreAllMocks());
import {SeriesConfigurationForm} from './ConfigurationForms';

const initialRules={positioning:'原定位',extension:{nested:['keep']}};
const props={initialName:'原名称',initialRules,isEditing:true,isPending:false,currentVersion:2,onCancel:vi.fn()};

it('已应用时锁定名称和规则，显式修改后一起保存；撤销恢复最近成功值',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const user=userEvent.setup(),onSave=vi.fn().mockResolvedValue(undefined),onRename=vi.fn().mockResolvedValue(true);
 render(<SeriesConfigurationForm {...props} headingContent={<div>系列目录</div>} onSave={onSave} onRename={onRename}/>);
 expect(screen.getByLabelText('系列显示名称')).toHaveProperty('readOnly',true);
 expect(screen.getByLabelText('系列定位')).toHaveProperty('readOnly',true);
 expect(screen.queryByRole('button',{name:'保存系列设置'})).toBeNull();
 expect(screen.queryByRole('button',{name:'撤销修改'})).toBeNull();
 expect(screen.getByLabelText('系列显示名称').compareDocumentPosition(screen.getByText('系列目录')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'修改'}));
 await user.clear(screen.getByLabelText('系列显示名称'));await user.type(screen.getByLabelText('系列显示名称'),'新名称');
 await user.clear(screen.getByLabelText('系列定位'));await user.type(screen.getByLabelText('系列定位'),'新定位');
 await user.click(screen.getByRole('button',{name:'保存系列设置'}));await user.click(screen.getByRole('button',{name:'确认保存为 v3'}));
 expect(onRename).toHaveBeenCalledExactlyOnceWith('新名称');
 expect(onSave).toHaveBeenCalledExactlyOnceWith('新名称',{positioning:'新定位',extension:{nested:['keep']}});
 expect(screen.getByLabelText('系列定位')).toHaveProperty('readOnly',true);
 await user.click(screen.getByRole('button',{name:'修改'}));await user.type(screen.getByLabelText('系列定位'),'草稿');await user.type(screen.getByLabelText('系列显示名称'),'草稿');
 await user.click(screen.getByRole('button',{name:'放弃修改'}));
 expect(screen.getByLabelText('系列定位')).toHaveProperty('value','新定位');expect(screen.getByLabelText('系列显示名称')).toHaveProperty('value','新名称');
 expect(screen.getByRole('status').textContent).toBe('已应用 · v2');
});

it('名称保存失败不写规则，保留草稿可撤销',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const user=userEvent.setup(),onSave=vi.fn();
 render(<SeriesConfigurationForm {...props} onRename={async()=>false} onSave={onSave}/>);
 await user.click(screen.getByRole('button',{name:'修改'}));await user.type(screen.getByLabelText('系列显示名称'),'草稿');
 await user.click(screen.getByRole('button',{name:'保存系列设置'}));await user.click(screen.getByRole('button',{name:'确认保存为 v3'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','系列名称未保存，请重试。');expect(onSave).not.toHaveBeenCalled();
 await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'取消'}));
 expect(screen.getByLabelText('系列显示名称')).toHaveProperty('value','原名称草稿');
 await user.click(screen.getByRole('button',{name:'放弃修改'}));expect(screen.getByLabelText('系列显示名称')).toHaveProperty('value','原名称');
});

it('名称成功但规则失败时说明实际状态，重试不重复重命名',async()=>{
 const user=userEvent.setup(),onRename=vi.fn().mockResolvedValue(true),onSave=vi.fn().mockRejectedValueOnce(Error('规则失败')).mockResolvedValue(undefined);
 render(<SeriesConfigurationForm {...props} onRename={onRename} onSave={onSave}/>);
 await user.click(screen.getByRole('button',{name:'修改'}));await user.type(screen.getByLabelText('系列显示名称'),'新');await user.type(screen.getByLabelText('系列定位'),'草稿');
 await user.click(screen.getByRole('button',{name:'保存系列设置'}));await user.click(screen.getByRole('button',{name:'确认保存为 v3'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','名称已保存，规则未应用：规则失败');
 expect(screen.getByLabelText('系列定位')).toHaveProperty('value','原定位草稿');
 await user.click(screen.getByRole('button',{name:'确认保存为 v3'}));
 expect(onRename).toHaveBeenCalledTimes(1);expect(onSave).toHaveBeenCalledTimes(2);
 expect(screen.getByLabelText('系列定位')).toHaveProperty('readOnly',true);
});

it('保存中禁用字段、撤销及确认，阻止重复提交',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const user=userEvent.setup();let resolve!:()=>void;const onSave=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
 render(<SeriesConfigurationForm {...props} onSave={onSave}/>);
 await user.click(screen.getByRole('button',{name:'修改'}));await user.click(screen.getByRole('button',{name:'保存系列设置'}));
 await user.click(screen.getByRole('button',{name:'确认保存为 v3'}));
 expect(screen.getByLabelText('系列定位')).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'取消编辑'})).toHaveProperty('disabled',true);
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'取消'})).toHaveProperty('disabled',true);
 await user.dblClick(within(dialog).getByRole('button',{name:'保存中…'}));expect(onSave).toHaveBeenCalledTimes(1);
 resolve();await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('status').textContent).toBe('已应用 · v2');
});

it('新建系列立即可填写并通过原创建接口提交',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const user=userEvent.setup(),onSave=vi.fn().mockResolvedValue(undefined);
 render(<SeriesConfigurationForm {...props} isEditing={false} initialName="" initialRules={{}} onSave={onSave}/>);
 expect(screen.getByLabelText('系列名称')).toHaveProperty('disabled',false);
 await user.type(screen.getByLabelText('系列名称'),'新系列');await user.click(screen.getByRole('button',{name:'创建系列'}));await user.click(screen.getByRole('button',{name:'确认创建系列'}));
 expect(onSave).toHaveBeenCalledExactlyOnceWith('新系列',{});
});
