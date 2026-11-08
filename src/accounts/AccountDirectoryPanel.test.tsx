import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {localCommand} from '../local-app/client';
import {AccountDirectoryPanel} from './AccountDirectoryPanel';
import {SeriesDirectoryPanel} from './SeriesDirectoryPanel';

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
 expect(await screen.findByText('尚未建立账号目录。')).toBe(screen.getByRole('status'));
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

it('series path appears once with open and copy actions, without a duplicate expansion',async()=>{
 command.mockResolvedValue({directoryPath:'/media/account/series',status:'ready'});
 render(<SeriesDirectoryPanel accountId="account" seriesId="series"/>);
 const path=await screen.findByText('/media/account/series');
 expect(path.getAttribute('title')).toBe('/media/account/series');
 expect(screen.queryByText('完整路径')).toBeNull();
 expect(screen.getByRole('button',{name:'打开系列目录'})).toHaveProperty('disabled',false);
 expect(screen.getByRole('button',{name:'复制系列目录路径'})).toHaveProperty('disabled',false);
});
