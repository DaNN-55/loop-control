import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalCatalogApp} from '../../../../src/local-app/LocalCatalogApp';
import {ownerSettingsFixture} from '../../../../src/local-app/fixtures/ownerSettingsFixture';
import {draftCatalog,draftSnapshot,draftWorkspace} from '../../../../src/local-app/fixtures/workspaceDraftFixture';
import {defaultOwnerPreferences} from '../../../../src/preferences/preferences';
import '../../../../src/styles.css';
import '../../../../src/ui/impeccable/foundation.css';
import '../../../../src/ui/impeccable/configuration.css';
import '../../../../src/ui/impeccable/maintenance.css';
import '../../../../src/ui/impeccable/production.css';
import '../../../../src/ui/impeccable/scroll-layout.css';
import '../../../../src/ui/impeccable/surface-polish.css';
import '../../../../src/ui/impeccable/detail-refinement.css';
import '../../../../src/ui/impeccable/interaction-refinement.css';

const fixture=ownerSettingsFixture();let preferences={...defaultOwnerPreferences,language:'en-US',displayName:'我的中文名称'};
window.fetch=async(input,init)=>{const url=new URL(String(input),location.origin),path=url.pathname;
 if(path.endsWith('/preferences')){if(init?.method==='POST')preferences=JSON.parse(String(init.body)).data;return Response.json(preferences);}
 if(path.endsWith('/catalog'))return Response.json(draftCatalog);
 if(path.endsWith('/workspace'))return Response.json({workspace:draftWorkspace(path.split('/')[4])});
 if(url.searchParams.has('known'))return Response.json({hashes:{},sections:draftSnapshot(path.split('/')[4])});
 if(path.includes('/workspace/project'))return Response.json({project:null});
 return fixture.request(input,init);
};
createRoot(document.getElementById('root')!).render(<StrictMode><LocalCatalogApp/></StrictMode>);
