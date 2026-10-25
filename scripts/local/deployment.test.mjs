// @vitest-environment node
import{it,expect,vi,beforeEach}from'vitest';
const fixture=vi.hoisted(()=>({files:new Map()}));const root='/isolated/.loop-control/stage-d',projectRoot='/isolated';
vi.mock('./environment.mjs',()=>({root:'/isolated/.loop-control/stage-d',projectRoot:'/isolated',appPort:55177,databasePort:55472,configuration:()=>({database:{}})}));
vi.mock('../isolation/environment.mjs',()=>({assertPrivatePath:vi.fn()}));
vi.mock('node:fs',()=>({existsSync:p=>fixture.files.has(p),realpathSync:p=>p,readFileSync:p=>{if(!fixture.files.has(p))throw Error('missing private file');return JSON.stringify(fixture.files.get(p));}}));
import{readDeployment}from'./deployment.mjs';
const base=root+'/state/t24-new',file=base+'/deployment.json',mediaRoot=base+'/volume/restored/media',receiptFile=base+'/volume/restored/restore-receipt.json';
const database={host:'127.0.0.1',port:55472,database:'loop_t24_restore_new',user:'loop_app',password:'synthetic'};
function config(){return{projectRoot,port:55189,database,worker:{},workerDatabase:{...database,user:'loop_worker'},mediaRoot,home:base+'/home',stateDirectory:base+'/state'};}
beforeEach(()=>{fixture.files.clear();fixture.files.set(file,config());fixture.files.set(receiptFile,{passed:true,publicationFence:true,connectionQualificationsCleared:true,database:database.database,mediaRoot});});
it('selects a restored deployment using the same strict normal startup reader',()=>{expect(readDeployment(file)).toMatchObject({database,mediaRoot,deploymentFile:file});});
it('rejects mismatched restore receipt, worker database, production paths and online policy',()=>{
 for(const change of[c=>{c.workerDatabase.database='loop_imported';},c=>{c.database.database='postgres';},c=>{c.mediaRoot='/Users/dan/Programs/loop-control/media';},c=>{c.connections={verification:'pexels-live'};}]){const c=config();change(c);fixture.files.set(file,c);expect(()=>readDeployment(file)).toThrow();}
 fixture.files.set(file,config());fixture.files.set(receiptFile,{passed:true,database:database.database,mediaRoot});expect(()=>readDeployment(file)).toThrow();
});
