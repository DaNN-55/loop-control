import {createWriteStream} from 'node:fs';
import {copyFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';

/** Explicit template SFX timing opts in; old/unfilled projects keep their export path. */
export function needsTemplateAudioAlignment(state){
 const shots=new Set((state.items??[]).filter(i=>{const p=i.loopControlShot?.renderPreferences;return p&&(p.sfxStart!==undefined||p.sfxDuration!==undefined);}).map(i=>i.loopControlShot.shotId));
 return(state.items??[]).some(i=>i.kind==='audio'&&i.loopControlAudio?.kind==='sfx'&&shots.has(i.loopControlAudio.shotId));
}

/** The SDK's WAV path is aligned; its H264/AAC path adds a common encode/mux delay.
 * Reuse the rendered video bitstream and encode aligned native PCM once. Never
 * guess a per-clip offset, respeed the source, or trim the beginning of speech. */
export async function alignTemplateAudioExport({origin,headers,body,outputPath,dataDir}){
 const response=await fetch(origin+'/export',{method:'POST',headers,body:JSON.stringify({...body,format:'audio',codec:'wav',name:'loop-control-timing'})});
 if(!response.ok||!response.body)throw Error(`原生音频时序导出失败（${response.status}）。`);
 const audio=join(dataDir,'aligned-native.wav'),aligned=join(dataDir,'aligned-output.mp4');
 await pipeline(Readable.fromWeb(response.body),createWriteStream(audio,{flags:'wx'}));
 const frames=body.state.items.reduce((end,i)=>Math.max(end,Number(i.startFrame)+Number(i.durationInFrames)),0),seconds=frames/body.state.fps;
 await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-i',outputPath,'-i',audio,'-map','0:v:0','-map','1:a:0','-map_metadata','0','-c:v','copy','-c:a','aac','-b:a','320k','-movflags','+faststart','-shortest',aligned],{timeout:Math.max(30000,Math.ceil(seconds*1000)),maxBuffer:1024*1024});
 await copyFile(aligned,outputPath);
}
