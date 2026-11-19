import {isDeepStrictEqual} from 'node:util';
import type {OpenChatCutProject} from './openchatcutProject.js';
/** JSON object key order is serialization, while array order and all values are edits. */
export function studioDraftChanges(baseline:OpenChatCutProject,native:OpenChatCutProject,host:OpenChatCutProject){
 return{nativeChanged:!isDeepStrictEqual(native,baseline),hostChanged:!isDeepStrictEqual(host,baseline)};
}
