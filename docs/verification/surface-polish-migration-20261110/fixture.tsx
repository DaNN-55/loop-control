import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '../../../src/ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../../../src/ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../../../src/ui/dan-ui/components/base/select/select-native';
import {WorkspacePromptField} from '../../../src/local-app/WorkspacePromptField';
import {WorkspaceGenerationModel} from '../../../src/local-app/WorkspaceGenerationModel';
import {ConfirmationModal} from '../../../src/ui/ConfirmationModal';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/local-app/production-compact.css';
import '../../../src/local-app/workspace-visual-preparation.css';
import '../../../src/local-app/workspace-visual-candidates.css';
import '../../../src/local-app/workspace-generation-composer.css';

const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';
const polish=document.createElement('link');
polish.id='approved-polish';polish.rel='stylesheet';
polish.href='/src/ui/impeccable/surface-polish.css?direct';
polish.disabled=params.get('polish')==='0';document.head.append(polish);

function Fixture(){
 const [value,setValue]=useState('自然光下的城市站台，保持画面克制。'),[kind,setKind]=useState('图片'),[model,setModel]=useState('one'),[dialog,setDialog]=useState(false),[confirmed,setConfirmed]=useState(false),[invalid,setInvalid]=useState(false);
 return <div className="app-shell dan-ui product-ui impeccable-app" data-sidebar="collapsed">
  <aside className="sidebar" aria-label="核对导航"><div className="lc-brand"><span>LC</span></div><nav className="navigation"><Button color="tertiary" className="navigation-item is-active" aria-label="生产单">制</Button></nav></aside>
  <section className="content-pane">
   <header className="page-header" data-check="page-header"><h1>正式控件样式核对</h1><Button color="secondary" data-check="open-confirm" onPress={()=>setDialog(true)}>确认操作</Button></header>
   <div className="account-workspace-layout" data-check="account-layout">
    <aside><nav><Button className="account-common-entry is-active" color="tertiary">通用规则</Button><Button color="tertiary">系列规则</Button></nav></aside>
    <div className="account-configuration-form"><form className="configuration-form" onSubmit={e=>e.preventDefault()}>
     <label>标题<InputBase size="sm" aria-label="核对标题" value="站台的最后一把伞" readOnly/></label>
     <label>模型<NativeSelect size="sm" aria-label="核对模型" value={model} onChange={e=>setModel(e.target.value)} options={[{value:'one',label:'模型一'},{value:'two',label:'模型二'}]}/></label>
     <label>规则<textarea aria-label="核对规则" rows={3} defaultValue="语言自然、具体、克制。"/></label>
     <div><Button color="secondary">撤销修改</Button><Button color="primary" onPress={()=>setConfirmed(true)}>应用规则</Button><Button color="primary" isDisabled>已应用</Button></div>
    </form></div>
   </div>
   <section className="production-workspace" data-compact-workflow>
    <section className="production-workspace-section workspace-preparation-detail" data-check="detail-surface">
     <div className="workspace-visual-preview-tabs" role="tablist" aria-label="画面类型">{['图片','视频'].map(x=><button key={x} id={x==='图片'?'fixture-image-tab':'fixture-video-tab'} type="button" role="tab" aria-controls="fixture-visual" tabIndex={kind===x?0:-1} aria-selected={kind===x} onClick={()=>setKind(x)}>{x}</button>)}</div>
     <div className="workspace-generation-composer" id="fixture-visual" role="tabpanel" aria-labelledby={kind==='图片'?'fixture-image-tab':'fixture-video-tab'} data-kind="image" data-check="composer">
      <div className="workspace-composer-input" data-check="prompt-surface"><div className="workspace-composer-reference"><button className="workspace-composer-add" aria-label="添加参考素材">+</button></div><div className="workspace-composer-prompt"><WorkspacePromptField label="图片提示词" ariaLabel="核对提示词" value={invalid?'超限内容'.repeat(20):value} limit={60} onChange={setValue}/></div></div>
      <div className="workspace-composer-toolbar"><span className="workspace-composer-kind">图片生成</span><WorkspaceGenerationModel kind="图片" services={[]} compact onChange={()=>{}}/><Button color="tertiary" className="workspace-composer-chip">9:16 · 1K</Button><Button color="primary" className="workspace-composer-submit" isDisabled={!value.trim()||invalid}>生成图片</Button></div>
     </div>
     <Button color="secondary" onPress={()=>setInvalid(v=>!v)}>{invalid?'恢复正常':'检查超限状态'}</Button>
    </section>
   </section>
   <p role="status">{confirmed?'演示确认成功':'仅渲染正式控件与样式，不接入业务数据。'}</p>
  </section>
  {dialog&&<ConfirmationModal title="确认规则" confirmLabel="确认" onCancel={()=>setDialog(false)} onConfirm={()=>{setConfirmed(true);setDialog(false);}}><p>仅核对正式弹窗外观与交互。</p></ConfirmationModal>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
