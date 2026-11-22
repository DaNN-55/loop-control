import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {PublicationCoverPicker} from './PublicationCoverPicker';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {useWorkspacePublication} from './useWorkspacePublication';
afterEach(cleanup);
const source={version:'workspace-cover-source/v1',kind:'material',id:'image',sha256:'sha'};
it('uses an existing picture once selected and leaves the current cover alone on cancelled file input',async()=>{
 const mutate=vi.fn(async()=>{}),p={state:{cover:null},mutate} as unknown as ReturnType<typeof useWorkspacePublication>;
 const w={id:'workspace',episodeId:'episode',exports:[],coverInputs:[{name:'现有封面',source}]} as unknown as ProductionWorkspace;
 render(<PublicationCoverPicker workspace={w} publication={p} readOnly={false}/>);
 fireEvent.click(screen.getByText('添加封面（可选）'));fireEvent.click(screen.getByRole('button',{name:'应用封面：现有封面'}));await waitFor(()=>expect(mutate).toHaveBeenCalledWith('cover',{kind:'existing',source}));expect(mutate).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'使用已选封面'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'本地上传'}));fireEvent.change(screen.getByLabelText('上传封面文件'),{target:{files:[]}});expect(mutate).toHaveBeenCalledTimes(1);
});
it('rejects an empty upload without changing the saved cover',async()=>{
 const mutate=vi.fn(),p={state:{cover:null},mutate} as unknown as ReturnType<typeof useWorkspacePublication>;
 render(<PublicationCoverPicker workspace={{exports:[]} as unknown as ProductionWorkspace} publication={p} readOnly={false}/>);
 fireEvent.click(screen.getByText('添加封面（可选）'));fireEvent.change(screen.getByLabelText('上传封面文件'),{target:{files:[new File([],'empty.png',{type:'image/png'})]}});await screen.findByRole('alert');expect(mutate).not.toHaveBeenCalled();
});

it('switches source tabs without saving and sends the actual video time only on apply',async()=>{
 const mutate=vi.fn(async()=>{}),p={state:{cover:null},mutate} as unknown as ReturnType<typeof useWorkspacePublication>;
 const w={episodeId:'episode',coverInputs:[{name:'现有封面',source}],exports:[{id:'export',status:'ready',current:true,artifact:{relativePath:'final.mp4',sha256:'video-sha'}}]} as unknown as ProductionWorkspace;
 render(<PublicationCoverPicker workspace={w} publication={p} readOnly={false}/>);fireEvent.click(screen.getByText('添加封面（可选）'));
 fireEvent.click(screen.getByRole('tab',{name:'成片选帧'}));const video=document.querySelector('video')!;video.currentTime=3.25;
 expect(mutate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'使用当前画面'}));await waitFor(()=>expect(mutate).toHaveBeenCalledWith('cover',{kind:'frame',exportId:'export',videoSha256:'video-sha',timeSeconds:3.25}));
 const pause=vi.spyOn(video,'pause').mockImplementation(()=>{}),details=document.querySelector('details')!;details.open=false;fireEvent(details,new Event('toggle'));expect(pause).toHaveBeenCalled();
});
it('keeps unavailable images disabled and retains the saved cover after failure',async()=>{
 const mutate=vi.fn(async()=>{throw Error('封面保存失败');}),cover={name:'保留.png',file:{relativePath:'saved.png',sha256:'saved',fileSize:100}};
 render(<PublicationCoverPicker workspace={{episodeId:'e',exports:[],coverInputs:[{name:'可用',source},{name:'缺失',source:{...source,id:'missing'},unavailableReason:'文件缺失'}]} as unknown as ProductionWorkspace} publication={{state:{cover},mutate} as unknown as ReturnType<typeof useWorkspacePublication>} readOnly={false}/>);
 fireEvent.click(screen.getByText('更换封面'));expect(screen.getByRole('button',{name:'应用封面：缺失'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'应用封面：可用'}));await screen.findByText('封面保存失败');expect(screen.getByRole('link',{name:'下载封面'}).getAttribute('href')).toContain('sha256=saved');
});
