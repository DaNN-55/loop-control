import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {useState} from 'react';
import {NativeSelect} from './dan-ui/components/base/select/select-native';
import {useDialogFocus} from './useDialogFocus';

afterEach(cleanup);
const options=[{value:'a',label:'选项 A'},{value:'b',label:'选项 B'},{value:'c',label:'选项 C',disabled:true}];
it('自定义圆角选项回传真实 change 事件并保留受控值、name 与表单边界',async()=>{
 const user=userEvent.setup(),change=vi.fn();
 function Fixture(){const[value,setValue]=useState('a');return <form aria-label="配置"><NativeSelect aria-label="供应商" name="provider" options={options} value={value} onChange={event=>{change(event.target instanceof HTMLSelectElement,event.target.value);setValue(event.target.value);}}/></form>;}
 render(<Fixture/>);const select=screen.getByRole('combobox',{name:'供应商'});
 await user.click(select);const list=await screen.findByRole('listbox',{name:'供应商'});
 expect(within(list).getAllByRole('option')).toHaveLength(3);
 expect(within(list).getByRole('option',{name:'选项 C'}).getAttribute('aria-disabled')).toBe('true');
 await user.click(within(list).getByRole('option',{name:'选项 B'}));
 expect(change).toHaveBeenCalledWith(true,'b');expect((select as HTMLSelectElement).value).toBe('b');
 expect(new FormData(screen.getByRole('form',{name:'配置'}) as HTMLFormElement).get('provider')).toBe('b');
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());
 await waitFor(()=>expect(document.activeElement).toBe(select));
});
it('非受控值保留原生 change/selectOptions 与 required 表单验证',async()=>{
 const user=userEvent.setup();render(<form aria-label="原生值"><NativeSelect label="连接" name="connection" required defaultValue="" options={[{value:'',label:'请选择'},...options]}/></form>);
 const select=screen.getByRole('combobox',{name:'连接'}) as HTMLSelectElement;
 expect(select.checkValidity()).toBe(false);await user.selectOptions(select,'b');
 expect(select.value).toBe('b');expect(select.checkValidity()).toBe(true);
 expect(new FormData(screen.getByRole('form',{name:'原生值'}) as HTMLFormElement).get('connection')).toBe('b');
});
it('optgroup 与禁用分组保留，禁用项不能改变选中值',async()=>{
 const user=userEvent.setup(),change=vi.fn();render(<NativeSelect label="账号" defaultValue="a" onChange={change}><optgroup label="使用中"><option value="a">账号 A</option></optgroup><optgroup label="已停用" disabled><option value="b">账号 B</option></optgroup></NativeSelect>);
 const select=screen.getByRole('combobox',{name:'账号'});await user.click(select);
 const list=await screen.findByRole('listbox');expect(within(list).getByText('使用中')).toBeTruthy();
 await user.click(within(list).getByRole('option',{name:'账号 B'}));expect(change).not.toHaveBeenCalled();expect((select as HTMLSelectElement).value).toBe('a');
});
it('disabled 及 disabled fieldset 不打开弹层',async()=>{
 const user=userEvent.setup();render(<><NativeSelect aria-label="单独禁用" disabled options={options}/><fieldset disabled><NativeSelect aria-label="分组禁用" options={options}/></fieldset></>);
 await user.click(screen.getByRole('combobox',{name:'单独禁用'}));await user.click(screen.getByRole('combobox',{name:'分组禁用'}));expect(screen.queryByRole('listbox')).toBeNull();
});
it('Arrow/Enter 打开，Escape 只关闭选项并恢复焦点，不关闭所在表单',async()=>{
 const user=userEvent.setup(),close=vi.fn();
 function Dialog(){const ref=useDialogFocus<HTMLDivElement>(true,close);return <div ref={ref} role="dialog" aria-label="编辑配置"><NativeSelect label="类型" options={options}/><button>下一个</button></div>;}
 render(<Dialog/>);const select=screen.getByRole('combobox',{name:'类型'});select.focus();await user.keyboard('{ArrowDown}');await screen.findByRole('listbox');await waitFor(()=>expect(screen.getByRole('listbox').contains(document.activeElement)).toBe(true));await user.keyboard('{ArrowDown}{Enter}');
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());expect(close).not.toHaveBeenCalled();
 select.focus();await user.keyboard('{Enter}');await screen.findByRole('listbox');await user.keyboard('{Escape}');
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());expect(close).not.toHaveBeenCalled();await waitFor(()=>expect(document.activeElement).toBe(select));
});
it('打开列表后 Tab 前往表单下一项，标签仍关联真实控件',async()=>{
 const user=userEvent.setup();render(<div><NativeSelect label="阶段" hint="请选择阶段" options={options}/><button>继续</button></div>);
 const select=screen.getByRole('combobox',{name:'阶段'});await user.click(screen.getByText('阶段',{selector:'label'}));expect(document.activeElement).toBe(select);
 await user.keyboard('{ArrowDown}');await screen.findByRole('listbox');await user.tab();await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'继续'})));
 expect(select.getAttribute('aria-describedby')).toBeTruthy();
});
it('外部受控 change 继续使用真实 select，并在下一次打开时反映新值',async()=>{
 const change=vi.fn();render(<NativeSelect aria-label="筛选" options={options} defaultValue="a" onChange={change}/>);
 const select=screen.getByRole('combobox');fireEvent.change(select,{target:{value:'b'}});expect(change).toHaveBeenCalledOnce();expect((select as HTMLSelectElement).value).toBe('b');
});

it('展开期间选项更新时按当前选项重新渲染，不把旧位置当成新值',async()=>{
 const user=userEvent.setup(),change=vi.fn();const view=render(<NativeSelect label="动态选项" defaultValue="a" options={options} onChange={change}/>);
 await user.click(screen.getByRole('combobox'));await screen.findByRole('listbox');
 view.rerender(<NativeSelect label="动态选项" defaultValue="a" options={[{value:'a',label:'选项 A'},{value:'new',label:'新增选项'}]} onChange={change}/>);
 const list=await screen.findByRole('listbox');await waitFor(()=>expect(within(list).queryByRole('option',{name:'选项 B'})).toBeNull());
 await user.click(within(list).getByRole('option',{name:'新增选项'}));await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());
 expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('new');expect(change).toHaveBeenCalledOnce();
});

it('表单 reset 保留非受控默认值并关闭旧菜单',async()=>{
 const user=userEvent.setup();render(<form aria-label="可重置"><NativeSelect label="范围" name="scope" defaultValue="a" options={options}/><button type="reset">重置</button></form>);
 const select=screen.getByRole('combobox'),form=screen.getByRole('form',{name:'可重置'}) as HTMLFormElement;await user.selectOptions(select,'b');expect((select as HTMLSelectElement).value).toBe('b');
 await user.click(select);await screen.findByRole('listbox');act(()=>form.reset());
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());expect((select as HTMLSelectElement).value).toBe('a');
});

it('同项 Enter 或鼠标重选只关闭列表，不派发 change 或重复触发业务',async()=>{
 const user=userEvent.setup(),change=vi.fn(),nativeChange=vi.fn();render(<NativeSelect label="声音来源" options={options} value="a" onChange={change}/>);
 const select=screen.getByRole('combobox');select.addEventListener('change',nativeChange);
 select.focus();await user.keyboard('{ArrowDown}');const list=await screen.findByRole('listbox');
 await waitFor(()=>expect(list.contains(document.activeElement)).toBe(true));await user.keyboard('{Enter}');
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(select));
 expect(change).not.toHaveBeenCalled();expect(nativeChange).not.toHaveBeenCalled();expect((select as HTMLSelectElement).value).toBe('a');
 await user.click(select);const reopened=await screen.findByRole('listbox');await user.click(within(reopened).getByRole('option',{name:'选项 A'}));
 await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());expect(change).not.toHaveBeenCalled();expect(nativeChange).not.toHaveBeenCalled();
});

it('外层标签作为菜单名称，不把选项文字拼进标题',async()=>{
 const user=userEvent.setup();render(<label>范围<NativeSelect options={[{value:'a',label:'选项 A'},{value:'b',label:'选项 B'}]}/></label>);
 await user.click(screen.getByRole('combobox',{name:'范围'}));
 expect(await screen.findByRole('listbox',{name:'范围'})).toBeTruthy();
});
