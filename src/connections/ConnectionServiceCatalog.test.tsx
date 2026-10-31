import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from './ConnectionWorkspace';
import {buildProductionServiceCatalog} from './serviceCatalog';
afterEach(cleanup);
it('groups saved connections by registered function and shows exact provider models and unavailable reasons',()=>{
 const connections=[{id:'a',name:'Image studio',provider:'openai',adapter:'openai_images',current_version_id:'a-v',status:'verified'},{id:'b',name:'Second studio',provider:'openai',adapter:'openai_images',current_version_id:'b-v',status:'unverified'},{id:'v',name:'Video studio',provider:'bailian',adapter:'wan_video',current_version_id:'v-v',status:'verified'}] as ExternalConnection[];
 const versions=connections.map(c=>({id:c.current_version_id,connection_id:c.id,provider:c.provider,adapter:c.adapter,is_current:true,revoked_at:null,status:c.status,version:1})) as ExternalConnectionVersion[];
 const catalog=buildProductionServiceCatalog({connections,versions,externalReady:true});
 render(<ConnectionWorkspace connections={connections} versions={versions} serviceCatalog={catalog} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 const table=screen.getByRole('table',{name:'已保存连接'});
 expect(within(table).getAllByText('gpt-image-2',{exact:false})).toHaveLength(2);
 expect(within(table).getByText('连接尚未验证通过。')).toBeTruthy();
 expect(within(table).getByText('wan2.6-i2v-flash',{exact:false})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('生产能力'),{target:{value:'video'}});
 expect(within(table).queryByText('Image studio')).toBeNull();expect(within(table).getByText('Video studio')).toBeTruthy();
 expect(screen.queryByText(/A-roll|B-roll/)).toBeNull();
});
