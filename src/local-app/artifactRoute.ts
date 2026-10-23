import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import type {ServerResponse} from 'node:http';
interface ArtifactFile {relative_path:string;sha256:string;file_size:string|number;source_asset_root:string;source_media_root:string}
export async function serveOwnedArtifact(root:string,artifact:ArtifactFile,response:ServerResponse){
 if(!artifact.source_media_root||!isAbsolute(artifact.source_asset_root))throw Error('Missing deployment mapping');
 const localRelative=relative(root,artifact.source_asset_root);
 const alreadyLocal=!localRelative.startsWith('..')&&!isAbsolute(localRelative);
 const accountRelative=alreadyLocal?localRelative:relative(artifact.source_media_root,artifact.source_asset_root);
 if(accountRelative.startsWith('..')||isAbsolute(accountRelative))throw Error('Source asset root outside import');
 const accountRoot=resolve(root,accountRelative);
 const path=resolve(accountRoot,artifact.relative_path),rel=relative(accountRoot,path);
 if(!rel||isAbsolute(artifact.relative_path)||rel.startsWith('..')||await realpath(path)!==path)throw Error('Unsafe artifact path');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();if(!before.isFile()||before.nlink!==1||before.size!==Number(artifact.file_size))throw Error('Artifact metadata differs');
  const hash=createHash('sha256');for await(const chunk of file.createReadStream({autoClose:false,start:0}))hash.update(chunk);
  const after=await file.stat();if(hash.digest('hex')!==artifact.sha256||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error('Artifact fingerprint differs');
  const types:Record<string,string>={'.mp4':'video/mp4','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
  response.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Content-Length':String(after.size),'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'});
  await pipeline(file.createReadStream({autoClose:false,start:0}),response);
 }finally{await file.close();}
}
