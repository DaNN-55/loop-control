// @vitest-environment node
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {createWorkerTaskPackage,validateWorkerResult,type WorkerTaskPackage} from '../worker/contracts';
import {inspectMp4Artifact} from '../worker/mediaTools';
import {executeNativeMedia} from './mediaWorker';

const ports=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('./narrationWorker',()=>({narrationPorts:ports.create}));
const run=promisify(execFile),directories:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();vi.resetAllMocks();await Promise.all(directories.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const fence={p_task_id:'11111111-1111-4111-8111-111111111111',p_attempt:0,p_lease_token:'33333333-3333-4333-8333-333333333333'};

it('crops real local video without resolving an unrelated frozen Provider reference',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-media-local-ref-'));directories.push(root);
 const source='episodes/episode-1/materials/source.mp4';await mkdir(join(root,'episodes/episode-1/materials'),{recursive:true});
 await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=160x284:r=30','-t','3','-c:v','libx264','-pix_fmt','yuv420p',join(root,source)]);
 const bytes=await readFile(join(root,source));
 const p=createWorkerTaskPackage({task:{id:fence.p_task_id,type:'generate_b_roll',attempt:0,budgetLimitCents:0,maxAttempts:1,provider:'ffmpeg',model:'ffmpeg',promptVersion:'shot-clip-v2'},episode:{id:'episode-1',accountId:'account-1',blueprintVersionId:'blueprint-1',title:'本机裁剪'},capability:'shot_clip_preparation',credentialRef:'22222222-2222-4222-8222-222222222222',allowedTools:['read','write'],allowedAssetRoot:root,output:{requiredArtifactTypes:['b_roll_asset'],contentType:'video/mp4',relativePath:'episodes/episode-1/native-tasks/'+fence.p_task_id+'/clip.mp4',reviewStage:'production_ready'},inputArtifacts:[{artifactType:'source_video',relativePath:source,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length}],media:{adapter:'ffmpeg_trim_video',videoClips:{sourceRelativePath:source,segments:[{startSeconds:0,endSeconds:1.248}],targetDurationSeconds:1.248}}});
 ports.create.mockRejectedValue(Error('Local media must not construct external credential or network ports'));
 const query=vi.fn(async()=>{throw Error('Local media must not resolve a Provider connection');}),fetcher=vi.fn(async()=>{throw Error('Local media must not issue a request');});vi.stubGlobal('fetch',fetcher);
 const result=validateWorkerResult(JSON.parse(await executeNativeMedia({query} as unknown as Pool,{mode:'local'},p,fence)),p);
 expect(result.status).toBe('completed');expect(p.credentialRef).toBe('22222222-2222-4222-8222-222222222222');
 const a=result.artifacts[0],output=await readFile(join(root,a.relativePath));expect(createHash('sha256').update(output).digest('hex')).toBe(a.sha256);expect(output.length).toBe(a.fileSize);
 expect((await inspectMp4Artifact(join(root,a.relativePath))).durationSeconds).toBeCloseTo(1.248,1);
 expect(query).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});

async function externalTask(provider:'pexels'|'volcengine_tts'):Promise<WorkerTaskPackage>{
 const root=await mkdtemp(join(tmpdir(),'native-media-external-guard-'));directories.push(root);const script=Buffer.from('自然');await mkdir(join(root,'episodes/episode-1'),{recursive:true});await writeFile(join(root,'episodes/episode-1/script.md'),script);const scriptSha=createHash('sha256').update(script).digest('hex');const visual=Buffer.from('# approved natural reference');await writeFile(join(root,'episodes/episode-1/visual.md'),visual);const visualSha=createHash('sha256').update(visual).digest('hex');
 return createWorkerTaskPackage({task:{id:fence.p_task_id,type:provider==='pexels'?'generate_b_roll':'generate_narration',attempt:0,budgetLimitCents:5,maxAttempts:1,provider,model:provider==='pexels'?'pexels-video-v1':'seed-tts-2.0',promptVersion:provider==='pexels'?'b-roll-v1':'narration-v1'},episode:{id:'episode-1',accountId:'account-1',blueprintVersionId:'blueprint-1',title:'外部连接围栏'},capability:provider==='pexels'?'b_roll_generation':'narration_generation',credentialRef:'22222222-2222-4222-8222-222222222222',allowedTools:['read','write'],allowedAssetRoot:root,output:{requiredArtifactTypes:[provider==='pexels'?'b_roll_asset':'narration_audio'],contentType:provider==='pexels'?'video/mp4':'audio/mpeg',relativePath:'episodes/episode-1/output.'+(provider==='pexels'?'mp4':'mp3'),reviewStage:'production_ready'},inputArtifacts:[{artifactType:'main_script',relativePath:'episodes/episode-1/script.md',sha256:scriptSha,fileSize:script.length},{artifactType:'visual_asset_manifest',relativePath:'episodes/episode-1/visual.md',sha256:visualSha,fileSize:visual.length}],media:provider==='pexels'?{adapter:'pexels_video',bRoll:{query:'nature',targetDurationSeconds:2,shot:{id:'shot-1',scriptSegment:'自然',durationSeconds:2,shotType:'b_roll',productionMethod:'nature',inputBasis:[{relativePath:'episodes/episode-1/script.md',sha256:scriptSha},{relativePath:'episodes/episode-1/visual.md',sha256:visualSha}],targetSpec:'1080x1920'}}}:{adapter:'volcengine_tts',narration:{text:'看见自然。',voice:{languageCode:'zh-CN',name:'zh_female_vv_uranus_bigtts',speakingRate:1}}}});
}

it.each(['pexels','volcengine_tts'] as const)('%s cannot use the local-only execution configuration',async provider=>{
 const p=await externalTask(provider),query=vi.fn(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(executeNativeMedia({query} as unknown as Pool,{mode:'local'},p,fence)).rejects.toThrow('在线媒体执行尚未配置');
 expect(query).not.toHaveBeenCalled();expect(ports.create).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});

it.each(['pexels','volcengine_tts'] as const)('%s still requires a matching fenced connection before reading a secret or transport',async provider=>{
 const p=await externalTask(provider),get=vi.fn(),fetcher=vi.fn(),query=vi.fn(async()=>({rows:[]}));
 ports.create.mockResolvedValue({mode:'controlled',store:{mode:'keychain',get},fetcher});
 await expect(executeNativeMedia({query} as unknown as Pool,{mode:'controlled',modulePath:'/unused-controlled-test'},p,fence)).rejects.toThrow();
 expect(query).toHaveBeenCalledWith('SELECT * FROM local_identity.input_media_connection($1,$2,$3,$4)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,p.credentialRef]);
 expect(get).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
