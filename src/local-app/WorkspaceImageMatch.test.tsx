import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceImageMatch} from './WorkspaceImageMatch';
afterEach(cleanup);
it('Owner chooses an image usage and explicitly persists duration and composition',async()=>{
 const command=vi.fn(async()=>({id:'workspace'}));render(<WorkspaceImageMatch clip={{id:'c',itemId:'i',shotId:'S01',text:'画面',source:null}} materials={[{id:'m',material_type:'image',source_path:'photo.png'}]} disabled={false} command={command} onVideo={()=>{}} onSaved={()=>{}}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'S01 素材'}),{target:{value:'m'}});fireEvent.change(screen.getByRole('combobox',{name:'使用方式'}),{target:{value:'pan-zoom'}});fireEvent.change(screen.getByLabelText('时长（秒）'),{target:{value:'2.5'}});expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'匹配图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('matchWorkspaceImage',{clipId:'c',materialRevisionId:'m',usage:'pan-zoom',durationSeconds:2.5,fit:'contain',focusX:0,focusY:0}));
});
