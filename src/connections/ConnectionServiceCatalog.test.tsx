import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from './ConnectionWorkspace';
import {buildProductionServiceCatalog} from './serviceCatalog';
afterEach(cleanup);
it('filters only this connections enabled models; absent settings preserve the registered defaults',()=>{
 const connections=[{id:'a',name:'Image A',provider:'openai',adapter:'openai_images',current_version_id:'a-v',status:'verified'},{id:'b',name:'Image B',provider:'openai',adapter:'openai_images',current_version_id:'b-v',status:'verified'}]as ExternalConnection[];
 const versions=connections.map(c=>({id:c.current_version_id,connection_id:c.id,provider:c.provider,adapter:c.adapter,is_current:true,revoked_at:null,status:c.status,version:1}))as ExternalConnectionVersion[];
 const catalog=buildProductionServiceCatalog({connections,versions,externalReady:true,enabledModels:{a:[]}});
 const services=catalog.groups.flatMap(g=>g.services);
 expect(services.find(s=>s.connectionId==='a')).toMatchObject({models:[],executable:false,unavailableReason:'尚未启用模型，请在更多操作中设置。'});
 expect(services.find(s=>s.connectionId==='b')).toMatchObject({models:['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare'],executable:true});
});
it('groups saved connections by registered function and shows exact provider models and unavailable reasons',()=>{
 const connections=[{id:'a',name:'Image studio',provider:'openai',adapter:'openai_images',current_version_id:'a-v',status:'verified'},{id:'b',name:'Second studio',provider:'openai',adapter:'openai_images',current_version_id:'b-v',status:'unverified'},{id:'v',name:'Video studio',provider:'bailian',adapter:'wan_video',current_version_id:'v-v',status:'verified'}] as ExternalConnection[];
 const versions=connections.map(c=>({id:c.current_version_id,connection_id:c.id,provider:c.provider,adapter:c.adapter,is_current:true,revoked_at:null,status:c.status,version:1})) as ExternalConnectionVersion[];
 const catalog=buildProductionServiceCatalog({connections,versions,externalReady:true});
 render(<ConnectionWorkspace connections={connections} versions={versions} serviceCatalog={catalog} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 const table=screen.getByRole('table',{name:'已保存连接'});
 expect(within(table).getAllByText('gpt-image-2',{exact:false})).toHaveLength(2);
 fireEvent.click(within(table).getByRole('button',{name:'Second studio 账务与凭据详情'}));
 expect(within(table).getByText('连接尚未验证通过。')).toBeTruthy();
 expect(within(table).getByText('wan2.6-i2v-flash',{exact:false})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('生产能力'),{target:{value:'video'}});
 expect(within(table).queryByText('Image studio')).toBeNull();expect(within(table).getByText('Video studio')).toBeTruthy();
 expect(screen.queryByText(/A-roll|B-roll/)).toBeNull();
});

it('shows credential status without reporting an authorization gate as a realtime network failure',()=>{
 const connection={id:'a',name:'Image studio',provider:'openai',adapter:'openai_images',current_version_id:'a-v',status:'verified'} as ExternalConnection;
 const version={id:'a-v',connection_id:'a',provider:'openai',adapter:'openai_images',is_current:true,revoked_at:null,status:'verified',version:1} as ExternalConnectionVersion;
 const catalog=buildProductionServiceCatalog({connections:[connection],versions:[version],externalReady:false});
 expect(catalog.groups.flatMap(g=>g.services).find(s=>s.connectionId==='a')?.executable).toBe(false);
 render(<ConnectionWorkspace connections={[connection]} versions={[version]} serviceCatalog={catalog} verificationEnabled onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 expect(screen.queryByText('当前执行网络不可用。')).toBeNull();
 expect(within(screen.getByRole('table',{name:'已保存连接'})).getByText('已验证').getAttribute('title')).toContain('不是实时网络检测结果');
 expect(screen.getByRole('button',{name:'连接验证说明'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'测试 Image studio'})).toHaveProperty('disabled',false);
});

it('summarizes multi-model connections and expands only the selected list without testing the connection',()=>{
 const connections=['A','B'].map(id=>({id,name:'视频连接 '+id,provider:'bailian',adapter:'wan_video',current_version_id:id+'-v',status:'verified'})) as ExternalConnection[];
 const versions=connections.map(c=>({id:c.current_version_id,connection_id:c.id,provider:c.provider,adapter:c.adapter,is_current:true,revoked_at:null,status:c.status,version:1})) as ExternalConnectionVersion[];
 const enabled=['wan2.6-i2v-flash','wan2.6-r2v'];
 const serviceCatalog=buildProductionServiceCatalog({connections,versions,externalReady:true,enabledModels:{A:enabled,B:enabled}}),testConnection=vi.fn();
 const models=serviceCatalog.groups.flatMap(group=>group.services).find(service=>service.connectionId==='A')!.models;
 render(<ConnectionWorkspace inlineBilling connections={connections} versions={versions} serviceCatalog={serviceCatalog} onCreateConnection={vi.fn()} onTestConnection={testConnection}/>);
 const table=within(screen.getByRole('table',{name:'已保存连接'}));
 expect(models.length).toBeGreaterThan(1);
 expect(table.getAllByText(models[0])).toHaveLength(2);
 expect(table.queryByText(models[1])).toBeNull();
 const toggleA=table.getByRole('button',{name:/视频连接 A · 查看/});
 fireEvent.click(toggleA);
 expect(toggleA.getAttribute('aria-expanded')).toBe('true');
 expect(within(table.getByRole('list',{name:'视频连接 A的模型'})).getAllByRole('listitem').map(item=>item.textContent)).toEqual(models);
 fireEvent.click(table.getByRole('button',{name:/视频连接 B · 查看/}));
 expect(table.queryByRole('list',{name:'视频连接 A的模型'})).toBeNull();
 fireEvent.click(table.getByRole('button',{name:'视频连接 B · 收起模型'}));
 expect(table.queryByRole('list',{name:'视频连接 B的模型'})).toBeNull();
 expect(testConnection).not.toHaveBeenCalled();
});
