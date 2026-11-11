import{useState}from'react';import{createRoot}from'react-dom/client';
import{OwnerPreferencesDialog}from'../../../../src/local-app/OwnerPreferencesDialog';
import{OwnerSettingsDialog}from'../../../../src/local-app/OwnerSettingsDialog';
import{defaultOwnerPreferences}from'../../../../src/preferences/preferences';
import{setUiLocale,useUiLocale}from'../../../../src/i18n/ui';
import'../../../../src/styles.css';import'../../../../src/ui/impeccable/foundation.css';import'../../../../src/ui/impeccable/configuration.css';import'../../../../src/ui/impeccable/surface-polish.css';
const demoLanguage=new URLSearchParams(location.search).get('language')==='en'?'en-US':'zh-CN';setUiLocale(demoLanguage);document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light';
const root={path:'/Volumes/示例素材盘/Media',canInitialize:false,status:'ready',migration:null};
const logs={activeDirectory:'/tmp/synthetic/logs',configuredDirectory:'/tmp/synthetic/logs',defaultDirectory:'/tmp/synthetic/logs',pending:false,warning:null};
window.fetch=async(input,init)=>{const path=String(input),body=init?.body?JSON.parse(String(init.body)):null;if(path.includes('media-root')){if(body?.command==='choose')return Response.json({path:'/Volumes/示例新盘/Media'});if(body?.command==='planMigration')return Response.json({id:'synthetic-plan',status:'planned',manifest:{sourceBinding:{path:root.path},targetBinding:{path:body.path},accounts:[],episodes:[],fileCount:2,totalBytes:1024,space:{freeBytes:10240,reserveBytes:1024,requiredBytes:2048},canExecute:true,conflicts:[],blockers:[]}});return Response.json(root);}return Response.json(logs);};
function Fixture(){useUiLocale();const[preferences,setPreferences]=useState({...defaultOwnerPreferences,language:demoLanguage,displayName:'保留中文名称'});return <main className="dan-ui product-ui"><OwnerSettingsDialog page="personal" onNavigate={()=>{}} onClose={()=>{}} returnFocusRef={{current:null}} canManageSecrets busy={false} email="owner@example.invalid"><OwnerPreferencesDialog embedded csrf="synthetic" preferences={preferences} page="personal" loading={false} saving={false} unavailable={false} error="" onReload={()=>{}} onClose={()=>{}} onSave={async value=>{setPreferences(value);setUiLocale(value.language);return true;}}/></OwnerSettingsDialog></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
