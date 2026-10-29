import {fileURLToPath} from 'node:url';

/** Versioned synthetic inputs, independent of agent scratch directories. */
export function workspaceTestMedia(name:string):string {
 return fileURLToPath(new URL('./fixtures/workspace-media/'+name,import.meta.url));
}
