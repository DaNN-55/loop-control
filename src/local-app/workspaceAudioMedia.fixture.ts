import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Synthetic tones only: transport/routing/gain evidence, never speech or music quality. */
export async function workspaceAudioMedia(root:string){
 const directory=join(root,'controlled-audio');await mkdir(directory,{recursive:true});const exec=promisify(execFile);
 const paths={voice:join(directory,'voice.mp3'),bgm:join(directory,'bgm.mp3'),sfx:join(directory,'sfx.mp3'),video:join(directory,'source.mp4')};
 for(const [path,frequency,seconds] of [[paths.voice,330,2.376],[paths.bgm,110,8],[paths.sfx,880,.4]] as const)await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000`,'-t',String(seconds),'-c:a','libmp3lame',path]);
 await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=red:size=360x640:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',paths.video]);
 const evidence=process.env.LOOP_T06_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});const probes:Record<string,unknown>={};for(const[name,path]of Object.entries(paths)){const{stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,duration,start_time,sample_rate','-of','json',path]);probes[name]={nominal:({voice:{hz:330,seconds:2.376},bgm:{hz:110,seconds:8},sfx:{hz:880,seconds:.4},video:{hz:440,seconds:4}} as Record<string,unknown>)[name],probe:JSON.parse(stdout)};}await writeFile(join(evidence,'input-codec-probes.json'),JSON.stringify(probes,null,2));}
 return paths;
}
