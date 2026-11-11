import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OwnerMenu} from '../../../src/workspace/WorkspaceViews';
import '../../../src/local-app/owner-preferences.css';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/detail-refinement.css';
import '../../../src/ui/impeccable/interaction-refinement.css';
function Fixture(){const[mode,setMode]=useState('long'),[action,setAction]=useState('');const name='所有者显示名称很长用于检查菜单是否横向滚动'.repeat(3),email='very-long-owner-address-for-overflow-check@example.invalid';return <main className="dan-ui product-ui" style={{padding:12}}><div style={{display:'flex',justifyContent:'space-between'}}><select aria-label="身份样例" value={mode} onChange={e=>setMode(e.target.value)}><option value="long">长名称和邮箱</option><option value="email">仅长邮箱</option><option value="short">短名称</option></select><OwnerMenu displayName={mode==='email'?undefined:mode==='long'?name:'示例所有者'} email={email} onOpenPreferences={()=>setAction('个人偏好')} onOpenNotifications={()=>setAction('通知')} onOpenSettings={()=>setAction('登录与安全')} onOpenLogs={()=>setAction('日志')} onOpenCleanup={()=>setAction('文件清理')} onOpenConnections={()=>setAction('连接配置')} onOpenSecrets={()=>setAction('密钥管理')} onSignOut={()=>setAction('退出登录')}/></div><p role="status">{action}</p></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
