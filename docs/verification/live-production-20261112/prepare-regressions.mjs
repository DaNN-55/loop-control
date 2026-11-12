// Separate SDK checkout for disposable integration fixtures; never alters the live editor copy.
import{readFile,access,cp,symlink}from'node:fs/promises';import{join}from'node:path';
const root=process.cwd(),d=JSON.parse(await readFile(join(root,'.scratch/live-production/deployment.json'),'utf8')),source=d.openChatCut.root,target=join(root,'.scratch/live-production/IntegrationOpenChatCut');
if(d.database.database!=='loop_live_acceptance'||d.database.port!==55439||!source.startsWith(join(root,'.scratch/live-production/')))throw Error('Acceptance deployment required');
try{await access(join(target,'package.json'));console.log('Existing dedicated integration SDK retained');}
catch(error){if(error.code!=='ENOENT')throw error;await cp(source,target,{recursive:true,filter:path=>!path.slice(source.length).split('/').some(p=>['node_modules','.git','.data','dist','.vite','data'].includes(p))});await symlink(join(source,'node_modules'),join(target,'node_modules'),'dir');console.log('Dedicated integration SDK prepared');}
