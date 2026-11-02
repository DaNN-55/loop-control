import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,extname,join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
const exec=promisify(execFile);
const formats:Record<string,{kind:string;mime:string[];codec?:string[];container?:string[]}>={
 '.png':{kind:'image',mime:['image/png'],codec:['png','apng'],container:['png_pipe','apng']},
 '.jpg':{kind:'image',mime:['image/jpeg'],codec:['mjpeg'],container:['jpeg_pipe','image2']},
 '.jpeg':{kind:'image',mime:['image/jpeg'],codec:['mjpeg'],container:['jpeg_pipe','image2']},
 '.webp':{kind:'image',mime:['image/webp'],codec:['webp'],container:['webp_pipe']},
 '.bmp':{kind:'image',mime:['image/bmp','image/x-ms-bmp'],codec:['bmp'],container:['bmp_pipe']},
 '.gif':{kind:'image',mime:['image/gif'],codec:['gif'],container:['gif']},
 '.tif':{kind:'image',mime:['image/tiff'],codec:['tiff'],container:['tiff_pipe']},
 '.tiff':{kind:'image',mime:['image/tiff'],codec:['tiff'],container:['tiff_pipe']},
 '.avif':{kind:'image',mime:['image/avif'],codec:['av1'],container:['mov','mp4']},
 '.mp4':{kind:'video',mime:['video/mp4'],container:['mov','mp4']},
 '.m4v':{kind:'video',mime:['video/mp4','video/x-m4v'],container:['mov','mp4']},
 '.mov':{kind:'video',mime:['video/quicktime'],container:['mov','mp4']},
 '.webm':{kind:'video',mime:['video/webm'],container:['webm','matroska']},
 '.mkv':{kind:'video',mime:['video/x-matroska'],container:['matroska']},
 '.avi':{kind:'video',mime:['video/x-msvideo'],container:['avi']},
 '.mp3':{kind:'audio',mime:['audio/mpeg','audio/mp3'],container:['mp3']},
 '.wav':{kind:'audio',mime:['audio/wav','audio/x-wav','audio/wave'],container:['wav']},
 '.m4a':{kind:'audio',mime:['audio/mp4','audio/x-m4a'],container:['mov','mp4']},
 '.aac':{kind:'audio',mime:['audio/aac'],container:['aac']},
 '.ogg':{kind:'audio',mime:['audio/ogg','application/ogg'],container:['ogg']},
 '.flac':{kind:'audio',mime:['audio/flac','audio/x-flac'],container:['flac']},
};
/** Validate the exact bytes before snapshot publication and material registration. */
export async function validateImportedMaterial(bytes:Buffer,input:{sourcePath:string;logicalName?:string;materialType:string;mimeType:string;materialPurpose:string;isMainScript:boolean}):Promise<string>{
 const name=basename(input.logicalName??input.sourcePath),format=formats[extname(name).toLowerCase()],mime=input.mimeType.toLowerCase().split(';')[0].trim();
 const fail=(detail:string):never=>{throw new ConfigurationError(400,`${name}：${detail}`);};
 if(!bytes.length)fail('文件为空，请重新选择。');
 if(bytes.length>100*1024*1024)fail('单个文件不能超过 100 MB。');
 const declared=['image','video','audio'].includes(input.materialType)?input.materialType:/^(image|video|audio)\//.exec(mime)?.[1];
 if(!declared&&!format)return input.mimeType; // Scripts and non-media reference documents retain their existing contract.
 if(!format||declared&&format.kind!==declared)fail('扩展名与素材类型不一致，请选择原始媒体文件。');
 if(mime&&mime!=='application/octet-stream'&&!format.mime.includes(mime))fail('文件类型与扩展名不一致。');
 const expectedPurpose=input.materialPurpose==='cover'?'image':input.materialPurpose==='a_roll'?'video':['narration','background_music','sound_effect'].includes(input.materialPurpose)?'audio':undefined;
 if(input.isMainScript||expectedPurpose&&expectedPurpose!==format.kind)fail('媒体类型与素材用途不一致。');
 const directory=await mkdtemp(join(tmpdir(),'loop-media-validation-'));
 try{
  const path=join(directory,'source'+extname(name).toLowerCase());await writeFile(path,bytes,{mode:0o600,flag:'wx'});
  const {stdout}=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=format_name,duration:stream=codec_type,codec_name,width,height','-of','json',path],{timeout:15000,maxBuffer:1024*1024});
  const metadata=JSON.parse(stdout) as {format?:{format_name?:string;duration?:string};streams?:Array<{codec_type?:string;codec_name?:string;width?:number;height?:number}>};
  const streams=metadata.streams??[],stream=streams.find(s=>s.codec_type===(format.kind==='audio'?'audio':'video'));
  if(!stream)return fail('文件缺少可读取的媒体内容。');
  if(format.codec&&!format.codec.includes(stream.codec_name??'')||format.container&&!format.container.some(c=>metadata.format?.format_name?.split(',').includes(c)))fail('扩展名与真实媒体内容不一致，或文件不可读取。');
  if(format.kind!=='audio'&&(!(Number(stream.width)>0)||!(Number(stream.height)>0)))fail('图片或视频尺寸无效。');
  if(format.kind!=='image'&&!(Number(metadata.format?.duration)>0))fail('媒体时长无效。');
  await exec('ffmpeg',['-nostdin','-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-threads','1','-i',path,'-map',format.kind==='audio'?'0:a:0':'0:v:0',...(format.kind==='video'?['-map','0:a?']:[]),'-f','null','-'],{timeout:120000,maxBuffer:1024*1024});
  return format.mime[0];
 }catch(error){
  if(error instanceof ConfigurationError)throw error;
  if((error as NodeJS.ErrnoException).code==='ENOENT')throw new ConfigurationError(503,`${name}：媒体校验工具不可用，请检查本机 FFmpeg 后重试。`);
  return fail('文件无法完整解码，请重新导出或选择完整的原始文件。');
 }finally{await rm(directory,{recursive:true,force:true});}
}
