import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountForm} from '../accounts/AccountForm';
import {CreativeRuleFields} from '../platform/CreativeRuleFields';
import {OwnerSettingsDialog} from '../local-app/OwnerSettingsDialog';
import {setUiLocale} from './ui';
import {accountsMessages} from './en/accounts';
afterEach(()=>{cleanup();setUiLocale('zh-CN');});
it('has English text for every assigned account and settings message',()=>{for(const [source,value] of Object.entries(accountsMessages)){expect(value,source).not.toMatch(/[\p{Script=Han}]/u);expect(value,source).not.toBe('');}});
it('uses English account labels and time zones while preserving the submitted Chinese account name',async()=>{
 setUiLocale('en-US');const submit=vi.fn(async()=>{}),user=userEvent.setup();render(<AccountForm isPending={false} onClose={()=>{}} onSubmit={submit}/>);
 await user.type(screen.getByLabelText('Account name'),'中文工作室');await user.type(screen.getByRole('textbox',{name:'Account ID'}),'content-studio');expect(screen.getByRole('option',{name:'Mainland China · Shanghai (Asia/Shanghai)'})).toBeTruthy();await user.click(screen.getByRole('button',{name:'Create account'}));expect(submit).toHaveBeenCalledWith(expect.objectContaining({name:'中文工作室',slug:'content-studio',timezone:'Asia/Shanghai'}));
});
it('translates rule field labels without translating saved creative values',()=>{
 setUiLocale('en-US');render(<CreativeRuleFields source={JSON.stringify({positioning:'讲述家乡故事',restrictions:['禁止虚构事实']})} onChange={()=>{}}/>);expect(screen.getByRole('textbox',{name:'Account positioning'})).toHaveProperty('value','讲述家乡故事');expect(screen.getByRole('textbox',{name:'Restrictions and prohibited content'})).toHaveProperty('value','禁止虚构事实');
});
it('translates the settings navigation while preserving the displayed owner identity',()=>{
 setUiLocale('en-US');render(<OwnerSettingsDialog page="personal" onNavigate={()=>{}} onClose={()=>{}} returnFocusRef={{current:null}} canManageSecrets busy={false} displayName="中文所有者" email="owner@example.invalid"><p>Body</p></OwnerSettingsDialog>);expect(screen.getByRole('navigation',{name:'Settings pages'})).toBeTruthy();expect(screen.getByRole('button',{name:'Connections'})).toBeTruthy();expect(screen.getByRole('button',{name:'Secrets'})).toBeTruthy();expect(screen.getByText('中文所有者')).toBeTruthy();
});
