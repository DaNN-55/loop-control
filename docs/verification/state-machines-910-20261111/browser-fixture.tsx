import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalCatalogApp} from '../../../src/local-app/LocalCatalogApp';
import {LocalConnectionsPanel} from '../../../src/local-app/LocalConnectionsPanel';
import {localRequest} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/detail-refinement.css';
import '../../../src/ui/impeccable/interaction-refinement.css';
function Connections(){const [open,setOpen]=useState(true);return <main className="impeccable-app dan-ui product-ui" style={{padding:16,maxWidth:1400,margin:'auto'}}><button onClick={()=>setOpen(v=>!v)}>{open?'关闭验收面板':'重新打开验收面板'}</button>{open&&<LocalConnectionsPanel settingsLayout/>}</main>;}
async function start(){await localRequest('session');createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('mode')==='connections'?<Connections/>:<LocalCatalogApp/>);}
void start();
