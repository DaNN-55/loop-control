import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ServerResponse} from 'node:http';
import type {FileHandle} from 'node:fs/promises';
import {openOwnedArtifact,type ArtifactFile} from './artifactRoute.js';

export type DeliveryArchiveMember={name:string}&({file:FileHandle;size:number;sha256:string}|{data:Buffer;size:number});
export const zip32Limit=0xffffffff;

/** Includes the end record, local and central headers, both UTF-8 names and each data descriptor. */
export function deliveryArchiveSize(entries:readonly {name:string;size:number}[]){
 return entries.reduce((total,entry)=>total+entry.size+92+2*Buffer.byteLength(entry.name),22);
}

export async function serveDeliveryArchive(root:string,entries:Array<{name:string;artifact:ArtifactFile}>,response:ServerResponse,episodeId:string){
 if(!entries.length||entries.length>32||new Set(entries.map(e=>e.name)).size!==entries.length||entries.some(e=>!/^[a-zA-Z0-9_.-]+$/.test(e.name)))throw Error('Invalid archive entries');
 const opened:Extract<DeliveryArchiveMember,{file:FileHandle}>[]=[];
 try{
  for(const entry of entries)opened.push({...await openOwnedArtifact(root,entry.artifact),name:entry.name,sha256:entry.artifact.sha256});
  await streamDeliveryArchive(opened,response,`delivery-${episodeId}.zip`);
 }finally{await Promise.allSettled(opened.map(e=>e.file.close()));}
}

/** Store-only ZIP32 over server-named, verified entries. The caller owns the file handles. */
export async function streamDeliveryArchive(entries:readonly DeliveryArchiveMember[],response:ServerResponse,filename:string){
 const size=deliveryArchiveSize(entries);
 if(size>=zip32Limit)throw Error('交付文件超过 ZIP 下载上限，请分别下载。');
 const opened=entries.map(entry=>({...entry,name:Buffer.from(entry.name)}));
  async function* archive(){
   let offset=0;const directory:Buffer[]=[];
   for(const entry of opened){
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0808,6);header.writeUInt16LE(0x21,12);header.writeUInt16LE(entry.name.length,26);
    const start=offset;yield header;yield entry.name;offset+=header.length+entry.name.length;
    let checksum=0,bytes=0;
    if('data' in entry){
     bytes=entry.data.length;checksum=crc32(entry.data);yield entry.data;
    }else{
     const sha=createHash('sha256');
     if(entry.size>0)for await(const chunk of entry.file.createReadStream({autoClose:false,start:0,end:entry.size-1})){
      const data=chunk as Buffer;bytes+=data.length;checksum=crc32(data,checksum);sha.update(data);yield data;
     }
     if((await entry.file.stat()).size!==entry.size||sha.digest('hex')!==entry.sha256)throw Error('Artifact changed during archive download');
    }
    if(bytes!==entry.size)throw Error('Artifact size changed during archive download');
    offset+=bytes;const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50,0);descriptor.writeUInt32LE(checksum,4);descriptor.writeUInt32LE(bytes,8);descriptor.writeUInt32LE(bytes,12);yield descriptor;offset+=16;
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0808,8);central.writeUInt16LE(0x21,14);central.writeUInt32LE(checksum,16);central.writeUInt32LE(bytes,20);central.writeUInt32LE(bytes,24);central.writeUInt16LE(entry.name.length,28);central.writeUInt32LE(start,42);directory.push(central,entry.name);
   }
   const directoryOffset=offset;for(const part of directory){yield part;offset+=part.length;}
   const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(opened.length,8);end.writeUInt16LE(opened.length,10);end.writeUInt32LE(offset-directoryOffset,12);end.writeUInt32LE(directoryOffset,16);yield end;
  }
  response.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${filename}"`,'Content-Length':size,'Cache-Control':'no-store'});
  await pipeline(Readable.from(archive()),response);
}
