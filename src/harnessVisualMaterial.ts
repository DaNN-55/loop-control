/** The bounded image/video subset supported by the Harness native upload routes. */
export const nativeVisualMaterialMaxBytes=20*1024*1024;
export const nativeVisualMaterialJsonMaxBytes=28*1024*1024;
const formats={
 png:{kind:'image',mime:'image/png'},
 jpg:{kind:'image',mime:'image/jpeg'},
 jpeg:{kind:'image',mime:'image/jpeg'},
 webp:{kind:'image',mime:'image/webp'},
 bmp:{kind:'image',mime:'image/bmp'},
 mp4:{kind:'video',mime:'video/mp4'},
 mov:{kind:'video',mime:'video/quicktime'},
 webm:{kind:'video',mime:'video/webm'},
} as const;
export function harnessVisualMaterial(name:string){
 const extension=/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
 return extension&&Object.hasOwn(formats,extension)?formats[extension as keyof typeof formats]:undefined;
}
export const nativeVisualMaterialAccept=Object.keys(formats).map(extension=>'.'+extension).join(',');
