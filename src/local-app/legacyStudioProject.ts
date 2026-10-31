import type {PoolClient} from 'pg';
import {episodeFileIO} from './episodeFiles.js';
import {createHash} from 'node:crypto';
import {inspectOpenChatCutStoredProject} from '../worker/openchatcutStudio.js';
import {ConfigurationError} from './configurationCommands.js';

/** Inspect the persisted native document without launching, adopting or saving it. */
export async function readLegacyStudioProject(c:PoolClient,root:string,episodeId:string){
 let stored;
 try{stored=await inspectOpenChatCutStoredProject(root,episodeId,await episodeFileIO(c,root,episodeId));}catch{throw new ConfigurationError(409,'已有剪辑工程读取失败，请检查原工程及来源映射。');}
 if(!stored)return null;
 const project=stored.project;
 if(project.version!==3||!Array.isArray(project.timelines)||!Array.isArray(project.assets))throw new ConfigurationError(409,'已有剪辑工程格式无效，原文件已保留。');
 const document=JSON.stringify(project,null,2)+'\n';
 return{project,sha256:createHash('sha256').update(document).digest('hex'),document};
}
