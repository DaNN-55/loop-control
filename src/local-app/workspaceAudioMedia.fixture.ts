import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
/** Synthetic tones only: transport/routing/gain evidence, never speech or music quality. */
export async function workspaceAudioMedia(root:string){
 const directory=join(root,'controlled-audio');await mkdir(directory,{recursive:true});const exec=promisify(execFile);
 const paths={voice:join(directory,'voice.mp3'),bgm:join(directory,'bgm.mp3'),sfx:join(directory,'sfx.mp3'),video:join(directory,'source.mp4')};
 for(const [path,frequency,seconds] of [[paths.voice,330,2.376],[paths.bgm,110,8],[paths.sfx,880,.4]] as const)await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000`,'-t',String(seconds),'-c:a','libmp3lame',path]);
 await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=red:size=360x640:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',paths.video]);
 return paths;
}
