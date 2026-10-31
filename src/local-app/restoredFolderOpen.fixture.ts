import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
export async function verifyRestoredFolderOpen(input:{origin:string;cookie:string;csrf:string;accountId:string;seriesId:string;episodeId:string;ownedRoot:string;output:string}){
 await mkdir(input.output,{recursive:true});const calls:unknown[]=[],observations:unknown[]=[];
 const post=async(route:string,command:string,data:Record<string,string>)=>{const r=await fetch(input.origin+route,{method:'POST',headers:{Origin:input.origin,'Content-Type':'application/json',Cookie:input.cookie,'X-CSRF-Token':input.csrf},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})}),body=await r.json();if(r.status!==200)throw Error(command+': '+JSON.stringify(body));calls.push({command,status:r.status,body});return body;};
 const observe=async(path:string)=>{try{const r=await exec('/usr/bin/osascript',['-e','on run argv\nset expected to (item 1 of argv) & "/"\ntell application "Finder"\nrepeat 20 times\nrepeat with w in (get windows)\ntry\nif (POSIX path of (target of w as alias)) is expected then\nclose w\nreturn expected\nend if\nend try\nend repeat\ndelay 0.1\nend repeat\nend tell\nerror "No actual owned Finder target observed"\nend run','--',path],{timeout:5000});observations.push({path,observed:true,closed:true,readback:r.stdout.trim()});}catch(error){observations.push({path,observed:false,reason:String(error)});}};
 let cleanup:unknown;
 try{
  const account=await post('/api/local/account-commands','readAssetDirectory',{accountId:input.accountId});await post('/api/local/account-commands','openAssetDirectory',{accountId:input.accountId});await observe(account.assetRoot);
  const series=await post('/api/local/account-commands','readSeriesDirectory',{seriesId:input.seriesId});await post('/api/local/account-commands','openSeriesDirectory',{seriesId:input.seriesId});await observe(series.directoryPath);
  const episode=await post('/api/local/episode-commands','openDirectory',{episodeId:input.episodeId});await observe(episode.path);
 }finally{
  try{cleanup=(await exec('/usr/bin/osascript',['-e','on run argv\nset closedCount to 0\nset remainingCount to 0\ntell application "Finder"\nrepeat with w in (get windows)\ntry\nif (POSIX path of (target of w as alias)) starts with ((item 1 of argv) & "/") then\nclose w\nset closedCount to closedCount + 1\nend if\nend try\nend repeat\nrepeat with w in (get windows)\ntry\nif (POSIX path of (target of w as alias)) starts with ((item 1 of argv) & "/") then set remainingCount to remainingCount + 1\nend try\nend repeat\nend tell\nreturn "closed=" & closedCount & ",remaining=" & remainingCount\nend run','--',input.ownedRoot],{timeout:5000})).stdout.trim();}catch(error){cleanup={unverified:true,reason:String(error)};}
  await writeFile(join(input.output,'native-folder-open.json'),JSON.stringify({actualDefaultNativeOpen:true,calls,observations,cleanup,globalWindowCount:'not asserted; macOS desktop may be locked'},null,2));
 }
}
