// Shared synthetic boundary for real Owner settings integration and browser checks.
// Never imported by the application entry, never forwards a request to a real API.
import {defaultOwnerPreferences} from '../../preferences/preferences';
export function ownerSettingsFixture(){
 const at='2026-11-11T08:00:00Z',ownerId='settings-owner',connectionId='settings-image',writes:Array<{path:string;command:string}>=[];
 let preferences=structuredClone(defaultOwnerPreferences),credential='synthetic-key-v1',revision=1;
 const connection={id:connectionId,name:'演示图片连接',description:'',provider:'openai',adapter:'openai_images',current_version_id:'settings-version-1',status:'verified',endpoint:'https://api.example.invalid/v1',last_verified_at:at};
 const versions=[{id:'settings-version-1',connection_id:connectionId,version:1,provider:'openai',adapter:'openai_images',status:'verified',is_current:true,revoked_at:null,secret_ref:'synthetic-reference-1',created_at:at}];
 const values=new Map([['synthetic-reference-1',credential]]);
 const catalog={page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[],accounts:[],blueprints:[],episodes:[],series:[],seriesVersions:[],promptVersions:[],blueprintRevisions:{},sourceCreatedAt:at,importedAt:at};
 const storage={activeDirectory:'/tmp/settings-fixture/logs',configuredDirectory:'/tmp/settings-fixture/logs',defaultDirectory:'/tmp/settings-fixture/logs',pending:false,warning:null};
 const metadata=(version:typeof versions[number])=>({reference:version.secret_ref,names:[connection.name],aliases:[],purpose:'图片生成',category:'connection',runtimeUses:[],connections:[{connectionId,name:connection.name,provider:'openai',version:version.version,current:version.is_current,revoked:false}],pendingUses:[],history:{metadataOccurrences:0,fileOccurrences:0,files:[]},revealAllowed:true,state:version.is_current?'当前连接使用':'历史版本'});
 const request=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=new URL(String(input),'http://fixture.invalid'),path=url.pathname.replace('/api/local/',''),body=init?.body?JSON.parse(String(init.body)):null;
  if(init?.method==='POST')writes.push({path,command:body?.command??path});
  if(path==='session')return Response.json({owner:{id:ownerId,email:'owner@example.invalid'},csrfToken:'synthetic-settings-csrf',secretAdministration:true});
  if(path==='preferences'){if(body)preferences=body.data;return Response.json(preferences);}
  if(path==='catalog')return Response.json(catalog);
  if(path==='connections'){
   if(body?.command==='update'){Object.assign(connection,{name:body.data.name,description:body.data.description});}
   if(body?.command==='rotate'){
    credential=body.data.secret;revision++;versions.forEach(v=>v.is_current=false);
    versions.unshift({...versions[0],id:`settings-version-${revision}`,version:revision,is_current:true,status:'unverified',secret_ref:`synthetic-reference-${revision}`});
    values.set(`synthetic-reference-${revision}`,credential);Object.assign(connection,{current_version_id:`settings-version-${revision}`,status:'unverified'});
   }
   if(body?.command==='verify'){
    const ready=!credential.includes('invalid');connection.status=ready?'verified':'invalid';versions[0].status=connection.status;
    return Response.json({ready,detail:ready?'示例连接验证通过。':'示例连接验证失败；新版本已保存，可修改后重新验证。'});
   }
   if(body)return Response.json({connection});
   return Response.json({connections:[connection],versions,capabilities:{secrets:'keychain',externalReady:true,verificationAvailable:true,networkAvailable:false}});
  }
  if(path==='secrets'){
   const items=versions.map(metadata).filter(item=>(!url.searchParams.get('q')||item.names[0].includes(url.searchParams.get('q')!))&&(!url.searchParams.get('category')||url.searchParams.get('category')==='all'||url.searchParams.get('category')==='connection'));
   return Response.json({items,total:items.length,page:1,pageSize:20,categoryCounts:{all:versions.length,connection:versions.length,system:0,history:0,orphan:0},observedAt:at});
  }
  if(path==='secrets/detail')return Response.json({item:metadata(versions.find(v=>v.secret_ref===url.searchParams.get('reference'))??versions[0])});
  if(path==='secrets/reveal')return body.password==='fixture-password-123'?Response.json({value:values.get(body.reference),expiresAt:new Date(Date.now()+30000).toISOString()}):Response.json({error:'身份验证失败，请重试。'},{status:403});
  if(path==='connection-models')return Response.json({connectionId,versionId:connection.current_version_id,revision:'fixture-models',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:false,capability:'图片'}],discovery:{supported:false,detail:'合成目录。',readAt:null}});
  if(path==='logs')return Response.json({observedAt:at,sourceAvailable:true,truncated:false,maxEntries:200,entries:[{id:'fixture-log',level:'INFO',occurredAt:at,time:null,episodeId:null,episodeName:null,operationId:null,requestId:null,source:'文件导入',message:'合成素材已登记',raw:'Synthetic log; no user content.',sourceFile:'fixture.log',line:1,explanation:{what:'素材已登记',result:'可在分镜台查看。'}}]});
  if(path==='deletion-cleanups')return Response.json([]);
  if(path==='recycle-bin')return Response.json({items:[],limitBytes:5e9,settingsRevision:1,usedBytes:0,pendingBytes:0,overLimit:false});
  if(path==='log-storage'){if(body?.command==='choose')return Response.json({path:'/tmp/settings-fixture/new-logs'});if(body?.command==='save')Object.assign(storage,{configuredDirectory:body.path,pending:body.path!==storage.activeDirectory});return Response.json(storage);}
  if(path==='media-root')return Response.json({path:'/Volumes/示例素材盘/Media',canInitialize:false,status:'ready',migration:null});
  if(path==='password')return Response.json({ok:true});
  if(path==='system-status')return Response.json({observedAt:at,automation:{stopped:false,lastError:null,lastScanAt:at,timezone:'Asia/Shanghai',hour:9,n8nRequired:false,backupsEnabled:false},operations:{},plans:[],jobs:[],runtime:null});
  return Response.json({});
 };
 return {request,writes,catalog,connection,versions,get preferences(){return preferences;}};
}
