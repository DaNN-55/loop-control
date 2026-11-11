import { act,fireEvent, render, screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionWorkspace, ExternalConnectionPicker } from "./ConnectionWorkspace";
import type {ConnectionModelSettings} from './connectionModels';
import type {ConnectionBillingSettings} from './connectionBilling';

const embeddedConnection={id:'embedded-connection',name:'嵌入连接',provider:'pexels',adapter:'pexels_video',status:'verified' as const,created_at:'',created_by:'owner',last_verification_detail:null,last_verified_at:null,description:'',endpoint:'https://api.example.invalid',current_version_id:'version-1'};
it('embeds the real credential editor without another dialog and preserves save-before-verification failure semantics',async()=>{
 const user=userEvent.setup(),onStateChange=vi.fn(),onRotateConnection=vi.fn().mockResolvedValue({...embeddedConnection,current_version_id:'version-2'}),onTestConnection=vi.fn().mockResolvedValue({ready:false,detail:'示例供应商拒绝验证'});
 render(<ConnectionWorkspace connections={[embeddedConnection]} inlineBilling settingsLayout inlineEditor onStateChange={onStateChange} onCreateConnection={vi.fn()} onRotateConnection={onRotateConnection} onTestConnection={onTestConnection}/>);
 await user.click(screen.getByRole('button',{name:'更换 嵌入连接 的密钥'}));
 expect(screen.getByRole('region',{name:'编辑连接'})).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('table',{name:'已保存连接'})).toBeNull();
 await user.type(screen.getByLabelText(/^新的 API Key/),'synthetic-new-credential');await user.click(screen.getByRole('button',{name:'保存并测试'}));
 expect(onRotateConnection).toHaveBeenCalledOnce();expect(onRotateConnection).toHaveBeenCalledWith({connectionId:embeddedConnection.id,provider:'pexels',adapter:'pexels_video',secret:'synthetic-new-credential'});expect(onTestConnection).toHaveBeenCalledWith(embeddedConnection.id);
 await screen.findByText('凭据已保存，连接测试未通过');expect((screen.getByLabelText(/^新的 API Key/) as HTMLInputElement).value).toBe('');expect(onStateChange).toHaveBeenCalledWith({busy:true,dirty:false});expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});
});
it('keeps credential lookup discoverable in an embedded detail and can open the requested connection',async()=>{
 const onOpenSecrets=vi.fn();render(<ConnectionWorkspace connections={[embeddedConnection]} initialConnectionId={embeddedConnection.id} inlineBilling settingsLayout inlineEditor onOpenSecrets={onOpenSecrets} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 expect(screen.getByRole('region',{name:embeddedConnection.name})).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'在密钥管理中查看'}));expect(onOpenSecrets).toHaveBeenCalledWith(embeddedConnection.id,embeddedConnection.name);
 fireEvent.click(screen.getByRole('button',{name:'返回连接列表'}));expect(screen.getByRole('table',{name:'已保存连接'})).toBeTruthy();
});
it('reports child model writes to the owner shell and releases it when save closes the child',async()=>{
 const user=userEvent.setup(),onStateChange=vi.fn(),connection={...embeddedConnection,provider:'openai',adapter:'openai_images'};
 const data:ConnectionModelSettings={connectionId:connection.id,versionId:'version-1',revision:'r1',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:true,capability:'图片'}],discovery:{supported:true,detail:'合成目录',readAt:null}};
 let finishRead!:(data:ConnectionModelSettings)=>void,finishWrite!:(data:ConnectionModelSettings)=>void;
 render(<ConnectionWorkspace connections={[connection]} inlineBilling settingsLayout inlineEditor onStateChange={onStateChange} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onReadModels={()=>new Promise(resolve=>{finishRead=resolve;})} onSyncModels={()=>new Promise(resolve=>{finishWrite=resolve;})} onSaveModels={()=>new Promise(resolve=>{finishWrite=resolve;})}/>);
 await user.click(screen.getByRole('button',{name:'嵌入连接 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});
 await act(async()=>finishRead(data));await user.click(screen.getByRole('button',{name:'读取模型'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:true,dirty:false});await act(async()=>finishWrite(data));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});await user.click(screen.getByRole('checkbox',{name:'gpt-image-2'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});await user.click(screen.getByRole('button',{name:'保存设置'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:true,dirty:false});await act(async()=>finishWrite({...data,enabledModels:[]}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'嵌入连接 模型设置'})).toBeNull());expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});
});
it('reports billing credential edits and every billing write through the connection pane',async()=>{
 const user=userEvent.setup(),onStateChange=vi.fn(),connection={...embeddedConnection,provider:'openai',adapter:'openai_images'};
 const initial:ConnectionBillingSettings={connectionId:connection.id,provider:'openai',configured:false,revision:'r1',updatedAt:null},saved={...initial,configured:true,revision:'r2'};
 let finish!:(data:ConnectionBillingSettings)=>void;const write=()=>new Promise<ConnectionBillingSettings>(resolve=>{finish=resolve;});
 render(<ConnectionWorkspace connections={[connection]} inlineBilling settingsLayout inlineEditor onStateChange={onStateChange} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onReadBilling={async()=>initial} onSaveBilling={write} onRefreshBilling={write} onDisconnectBilling={write}/>);
 await user.click(screen.getByRole('button',{name:'嵌入连接 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'账务设置'}));await user.type(await screen.findByLabelText('OpenAI Admin API Key'),'synthetic-billing-key');
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:true});await user.click(screen.getByRole('button',{name:'验证并保存'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:true,dirty:true});await act(async()=>finish(saved));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});await user.click(screen.getByRole('button',{name:'刷新账务'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:true,dirty:false});await act(async()=>finish(saved));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});await user.click(screen.getByRole('button',{name:'断开「嵌入连接」的账务关联'}));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:true,dirty:false});await act(async()=>finish(initial));
 expect(onStateChange).toHaveBeenLastCalledWith({busy:false,dirty:false});
});

describe("外部连接工作区", () => {
  it("说明连接名称和认证材料应填写的内容", () => {
    render(<ConnectionWorkspace connections={[]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name:"新建连接"}));

    expect(screen.getByLabelText(/^连接名称/)).toBeTruthy();
    expect(screen.getByText("Pexels API Key")).toBeTruthy();
  });

  it("在蓝图配置中说明新连接应填写的内容", () => {
    render(<ExternalConnectionPicker adapter="pexels_video" connections={[]} onCreateConnection={vi.fn()} onSelectVersion={vi.fn()} provider="pexels" selectedVersionId="" />);

    expect(screen.getByLabelText("新连接名称")).toBeTruthy();
    expect(screen.getByText("认证材料（填写对应服务的 API Key）")).toBeTruthy();
  });

  it("从空连接池创建并显式测试 Pexels 连接，表单提交后清空密钥", async () => {
    const user = userEvent.setup();
    const connection = { id: "connection-1", name: "主 Pexels", provider: "pexels", adapter: "pexels_video", status: "unverified" as const, created_at: "", created_by: "owner", last_verification_detail: null, last_verified_at: null, description: "", endpoint: "", current_version_id: "version-1" };
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    const onCreateConnection = vi.fn(async ():Promise<typeof connection> => {
      view.rerender(<ConnectionWorkspace connections={[connection]} onCreateConnection={onCreateConnection} onTestConnection={onTestConnection} />);
      return connection;
    });
    const view = render(<ConnectionWorkspace connections={[]} onCreateConnection={onCreateConnection} onTestConnection={onTestConnection} />);
    fireEvent.click(screen.getByRole("button", {name:"新建连接"}));

    expect(screen.getByRole("dialog",{name:"新建连接"})).toBeTruthy();
    await user.type(screen.getByLabelText(/^连接名称/), "主 Pexels");
    await user.type(screen.getByLabelText(/^Pexels API Key/), "secret-key");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onCreateConnection).toHaveBeenCalledWith({ adapter: "pexels_video", name: "主 Pexels", provider: "pexels", secret: "secret-key" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
    expect((screen.getByLabelText(/^新的 API Key/) as HTMLInputElement).value).toBe("");
  });

  it("不再提供 Google TTS 或 Cloudflare 新连接", () => {
    render(<ConnectionWorkspace connections={[]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", {name:"新建连接"}));
    expect(screen.queryByRole('option',{name:/Google TTS|Cloudflare/})).toBeNull();
  });

  it("可预先登记火山语音 Adapter 凭据", async () => {
    const user = userEvent.setup();
    const onCreateConnection = vi.fn().mockResolvedValue({ id: "connection-volc", name: "主火山语音", provider: "volcengine_tts", adapter: "volcengine_tts", status: "unverified" });
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionWorkspace connections={[]} onCreateConnection={onCreateConnection} onTestConnection={onTestConnection} />);
    fireEvent.click(screen.getByRole("button", {name:"新建连接"}));

    await user.selectOptions(screen.getByLabelText("连接类型"), "volcengine_tts");
    await user.type(screen.getByLabelText(/^豆包语音 API Key/), "api-key");
    await user.type(screen.getByLabelText(/^连接名称/), "主火山语音");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onCreateConnection).toHaveBeenCalledWith({ adapter: "volcengine_tts", name: "主火山语音", provider: "volcengine_tts", secret: "api-key" });
  });

  it("轮换版本后只测试新连接并保留版本操作边界", async () => {
    const user = userEvent.setup();
    const connection = { adapter: "openai_images", created_at: "", created_by: "owner", current_version_id: "version-2", description: "", endpoint: "https://api.openai.com/v1", id: "connection-1", last_verification_detail: null, last_verified_at: null, name: "主 OpenAI", provider: "openai", status: "verified" as const };
    const onRotateConnection = vi.fn().mockResolvedValue(connection);
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    const onRevokeVersion = vi.fn().mockResolvedValue(undefined);
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onDeleteVersion={onDeleteVersion} onRevokeVersion={onRevokeVersion} onRotateConnection={onRotateConnection} onTestConnection={onTestConnection} versions={[{ adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-1", is_current: false, provider: "openai", revoked_at: null, status: "verified", version: 1, usage:{currentBlueprints:0,episodes:0,tasks:0,activeTasks:0,requests:0,savedSelections:0} }, { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-2", is_current: true, provider: "openai", revoked_at: null, status: "unverified", version: 2 }, { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-3", is_current: false, provider: "openai", revoked_at: null, status: "unverified", version: 3 }]} />);

    await user.click(screen.getByRole("button",{name:"主 OpenAI"}));
    await user.click(screen.getByRole("button",{name:"编辑连接"}));
    await user.type(screen.getByLabelText(/^新的 API Key/), "new-secret");
    await user.click(screen.getByRole("button", { name: "保存并测试" }));
    expect(onRotateConnection).toHaveBeenCalledWith({ adapter: "openai_images", connectionId: "connection-1", provider: "openai", secret: "new-secret" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
    await user.click(screen.getByText("连接版本（3）"));
    await user.click(screen.getAllByRole("button", { name: "撤销版本" })[0]);
    await user.click(screen.getByRole("button",{name:"确认撤销 v1"}));
    expect(onRevokeVersion).toHaveBeenCalledWith("version-1");
    await user.click(screen.getByRole("button", { name: "删除草稿" }));
    expect(onDeleteVersion).toHaveBeenCalledWith("version-3");
  });

  it("轮换后只保留当前且已验证版本，并自动绑定到蓝图", () => {
    const onSelectVersion = vi.fn();
    const versions = [
      { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-1", is_current: false, provider: "openai", revoked_at: null, status: "verified" as const, version: 1 },
      { adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-2", is_current: true, provider: "openai", revoked_at: null, status: "verified" as const, version: 2 },
    ];
    render(<ExternalConnectionPicker adapter="openai_images" connections={[{ adapter: "openai_images", created_at: "", created_by: "owner", current_version_id: "version-2", description: "", endpoint: "https://api.openai.com/v1", id: "connection-1", last_verification_detail: null, last_verified_at: null, name: "主 OpenAI", provider: "openai", status: "verified" }]} onSelectVersion={onSelectVersion} provider="openai" selectedVersionId="" versions={versions} />);

    expect(screen.queryByRole("combobox", { name: "外部连接 外部连接" })).toBeNull();
    expect(screen.getByText("主 OpenAI · v2 · 已验证")).toBeTruthy();
    expect(onSelectVersion).toHaveBeenCalledWith("version-2");
  });

  it("编辑当前连接可只改名称，或同时创建并测试认证版本", async () => {
    const user = userEvent.setup();
    const connection = { adapter: "openai_images", created_at: "", created_by: "owner", current_version_id: "version-2", description: "", endpoint: "https://api.openai.com/v1", id: "connection-1", last_verification_detail: null, last_verified_at: null, name: "主 OpenAI", provider: "openai", status: "verified" as const };
    const onUpdateConnection = vi.fn().mockResolvedValue(undefined);
    const onRotateConnection = vi.fn().mockResolvedValue(connection);
    const onTestConnection = vi.fn().mockResolvedValue(undefined);
    render(<ExternalConnectionPicker adapter="openai_images" connections={[connection]} onRotateConnection={onRotateConnection} onSelectVersion={vi.fn()} onTestConnection={onTestConnection} onUpdateConnection={onUpdateConnection} provider="openai" selectedVersionId="version-2" versions={[{ adapter: "openai_images", connection_id: "connection-1", created_at: "", endpoint: "https://api.openai.com/v1", id: "version-2", is_current: true, provider: "openai", revoked_at: null, status: "verified", version: 2 }]} />);

    await user.click(screen.getByText("更新连接"));
    await user.clear(screen.getByLabelText("编辑连接名称"));
    await user.type(screen.getByLabelText("编辑连接名称"), "Cloudflare 图片");
    await user.click(screen.getByRole("button", { name: "保存连接更新" }));
    expect(onUpdateConnection).toHaveBeenCalledWith({ connectionId: "connection-1", description: "", name: "Cloudflare 图片" });
    expect(onRotateConnection).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", {name:"更新连接"}));
    await user.type(screen.getByLabelText("编辑连接 API Key"), "new-secret");
    await user.click(screen.getByRole("button", { name: "保存连接更新" }));
    expect(onRotateConnection).toHaveBeenCalledWith({ adapter: "openai_images", connectionId: "connection-1", provider: "openai", secret: "new-secret" });
    expect(onTestConnection).toHaveBeenCalledWith("connection-1");
  });
});
