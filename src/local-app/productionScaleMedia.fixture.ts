import {createHash} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';

/** Two controlled sound-editing workloads, not a benchmark or a capacity claim. */
export const productionScaleCases=[
 {name:'four-source-short',sources:4,sourceSeconds:30,cutsPerSource:4,outputSeconds:12},
 {name:'eight-source-large',sources:8,sourceSeconds:130,cutsPerSource:8,outputSeconds:12},
] as const;

/** Valid PCM WAVs written one second at a time, without FFmpeg or giant allocations.
 * Long source recordings are deliberately trimmed into a short production.
 */
export async function productionScaleMedia(root:string,options:typeof productionScaleCases[number]){
 await mkdir(root,{recursive:true});const sampleRate=48000,bytesPerSecond=sampleRate*2;
 const results:Array<{path:string;sha256:string;fileSize:number;seconds:number;frequency:number}>=[];
 for(let n=0;n<options.sources;n++){
  const path=join(root,`scale-${n}.wav`),frequency=110+n*55,dataSize=options.sourceSeconds*bytesPerSecond;
  const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(dataSize+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(bytesPerSecond,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(dataSize,40);
  const second=Buffer.alloc(bytesPerSecond);for(let i=0;i<sampleRate;i++)second.writeInt16LE(Math.round(2048*Math.sin(2*Math.PI*frequency*i/sampleRate)),i*2);
  const file=await open(path,'wx'),hash=createHash('sha256');
  try{await file.write(header);hash.update(header);for(let s=0;s<options.sourceSeconds;s++){await file.write(second);hash.update(second);}}finally{await file.close();}
  results.push({path,sha256:hash.digest('hex'),fileSize:44+dataSize,seconds:options.sourceSeconds,frequency});
 }
 return results;
}
