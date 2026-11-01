import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {localCommand} from '../local-app/client';
import {AccountDirectoryPanel} from './AccountDirectoryPanel';

vi.mock('../local-app/client',()=>({localCommand:vi.fn()}));
const command=vi.mocked(localCommand);
afterEach(()=>{cleanup();vi.resetAllMocks();});

it('shows only the actual account directory and opens it without reading migration history',async()=>{
 command.mockResolvedValue({assetRoot:'/media/account',status:'ready',legacyRoots:['/old/account'],reason:'旧目录需要登记'});
 render(<AccountDirectoryPanel accountId="account"/>);
 await screen.findByText('/media/account');
 expect(screen.queryByText('/old/account')).toBeNull();
 expect(screen.queryByText(/登记|迁移|历史|专属/)).toBeNull();
 expect(screen.queryByRole('textbox')).toBeNull();
 expect(command).toHaveBeenCalledExactlyOnceWith('readAssetDirectory',{accountId:'account'},undefined,'account-commands');
 fireEvent.click(screen.getByRole('button',{name:'打开'}));
 await waitFor(()=>expect(command).toHaveBeenLastCalledWith('openAssetDirectory',{accountId:'account'},undefined,'account-commands'));
});

it('does not substitute a legacy location or offer legacy repair when the current directory is absent',async()=>{
 command.mockResolvedValue({assetRoot:null,status:'unset',legacyRoots:['/old/account'],reason:'请设置账号实际专属目录。'});
 render(<AccountDirectoryPanel accountId="account"/>);
 await screen.findByText('暂未生成');
 expect(screen.queryByText('/old/account')).toBeNull();
 expect(screen.queryByText('请设置账号实际专属目录。')).toBeNull();
 expect(screen.getByRole('button',{name:'打开'})).toHaveProperty('disabled',true);
 expect(screen.getByRole('button',{name:'复制账号目录路径'})).toHaveProperty('disabled',true);
 expect(command).toHaveBeenCalledTimes(1);
});

it('keeps the current path visible and allows retry after an open failure',async()=>{
 command.mockImplementation(async name=>{if(name==='openAssetDirectory')throw Error('打开失败，请重试。');return {assetRoot:'/media/account',status:'ready'} as never;});
 render(<AccountDirectoryPanel accountId="account"/>);
 await screen.findByText('/media/account');
 fireEvent.click(screen.getByRole('button',{name:'打开'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','打开失败，请重试。');
 expect(screen.getByText('/media/account')).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('button',{name:'打开'})).toHaveProperty('disabled',false));
});
