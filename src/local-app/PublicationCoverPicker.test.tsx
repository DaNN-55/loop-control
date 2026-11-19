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
 fireEvent.change(screen.getByLabelText('已有图片'),{target:{value:JSON.stringify(source)}});await waitFor(()=>expect(mutate).toHaveBeenCalledWith('cover',{kind:'existing',source}));expect(mutate).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'使用已选封面'})).toBeNull();
 fireEvent.change(screen.getByLabelText('本地上传'),{target:{files:[]}});expect(mutate).toHaveBeenCalledTimes(1);
});
it('rejects an empty upload without changing the saved cover',async()=>{
 const mutate=vi.fn(),p={state:{cover:null},mutate} as unknown as ReturnType<typeof useWorkspacePublication>;
 render(<PublicationCoverPicker workspace={{exports:[]} as unknown as ProductionWorkspace} publication={p} readOnly={false}/>);
 fireEvent.change(screen.getByLabelText('本地上传'),{target:{files:[new File([],'empty.png',{type:'image/png'})]}});await screen.findByRole('alert');expect(mutate).not.toHaveBeenCalled();
});
