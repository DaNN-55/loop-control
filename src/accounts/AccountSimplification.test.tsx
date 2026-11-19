import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountForm} from './AccountForm';
import {BlueprintConfigurationForm,SeriesConfigurationForm} from '../platform/ConfigurationForms';
afterEach(cleanup);

it('creates a Chinese-named account without asking for an identifier, retaining one identifier after a failed save',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockRejectedValueOnce(Error('暂时失败')).mockResolvedValue(undefined);
 render(<AccountForm isPending={false} onClose={()=>{}} onSubmit={save}/>);
 expect(screen.queryByRole('textbox',{name:'账号标识'})).toBeNull();
 await user.type(screen.getByLabelText('账号名称'),'山间故事');await user.click(screen.getByRole('button',{name:'创建账号'}));
 await screen.findByRole('alert');await user.click(screen.getByRole('button',{name:'创建账号'}));
 expect(save).toHaveBeenCalledTimes(2);expect(save.mock.calls[0][0]).toMatchObject({name:'山间故事',timezone:'Asia/Shanghai',slug:expect.stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)});
 expect(save.mock.calls[1][0].slug).toBe(save.mock.calls[0][0].slug);
});

it('saves four optional common rules directly and retains unopened nested rules',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockResolvedValue(undefined),extension={flags:[true,false],limits:{max:3},custom:null};
 render(<BlueprintConfigurationForm accountLayout initialAssetRoot="" initialPolicy={{positioning:'做什么',tone:'克制',extension}} isPending={false} onCancel={()=>{}} onSave={save}/>);
 expect(screen.queryByRole('checkbox',{name:'扩展规则 1'})).toBeNull();expect(screen.queryByRole('spinbutton',{name:'max'})).toBeNull();
 expect(screen.getByLabelText('内容定位')).toHaveProperty('readOnly',true);
 await user.click(screen.getByRole('button',{name:'修改'}));fireEvent.change(screen.getByLabelText('说话方式'),{target:{value:'自然'}});
 await user.click(screen.getByRole('button',{name:'保存通用规则'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({positioning:'做什么',tone:'自然',extension},true));expect(screen.queryByRole('dialog')).toBeNull();
 await user.click(screen.getByText('其他已存规则'));expect(screen.getByRole('spinbutton',{name:'max'})).toHaveProperty('value','3');
});

it('shows only series custom values first, with inherited values and both restrictions in the effective rules',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockResolvedValue(undefined);
 render(<SeriesConfigurationForm initialName="故事系列" initialRules={{positioning:'系列定位',restrictions:'不误导',extension:{nested:['keep']}}} accountPolicy={{positioning:'账号定位',visual_style:'自然光',restrictions:'不侵权'}} isEditing isPending={false} onCancel={()=>{}} onSave={save}/>);
 expect(screen.getByLabelText('视觉风格')).toHaveProperty('value','');expect(screen.getByLabelText('限制与禁用内容')).toHaveProperty('value','不误导');
 await user.click(screen.getByText('查看完整生效规则'));
 expect(screen.getByLabelText('生效的画面风格')).toHaveProperty('value','自然光');expect(screen.getByLabelText('生效的内容禁区')).toHaveProperty('value',expect.stringContaining('不侵权'));
 await user.click(screen.getByRole('button',{name:'修改'}));fireEvent.change(screen.getByLabelText('系列定位'),{target:{value:'新定位'}});await user.click(screen.getByRole('button',{name:'保存系列设置'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith('故事系列',{positioning:'新定位',restrictions:'不误导',extension:{nested:['keep']}}));expect(screen.queryByRole('dialog')).toBeNull();
});
