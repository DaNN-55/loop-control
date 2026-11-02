// jsdom omits this browser API, which React Aria uses for collection IDs.
// Keep the browser implementation untouched; provide CSSOM escaping in tests.
if (!globalThis.CSS?.escape) {
  const escape = (value: string) => Array.from(String(value), (char, index) => {
    const code = char.codePointAt(0)!;
    if (code === 0) return '\uFFFD';
    if (code < 32 || code === 127 || index === 0 && /[0-9]/.test(char) || index === 1 && /[0-9]/.test(char) && value[0] === '-') return `\\${code.toString(16)} `;
    if (index === 0 && char === '-' && value.length === 1) return '\\-';
    return code >= 128 || /[a-zA-Z0-9_-]/.test(char) ? char : `\\${char}`;
  }).join('');
  Object.defineProperty(globalThis, 'CSS', {value: {...globalThis.CSS, escape}, configurable: true});
}

// jsdom supplies audioTracks as an array; browser AudioTrackList also emits events.
// Supply the missing empty EventTarget list for media component integration tests.
if(typeof HTMLMediaElement!=='undefined'){
const audioTrackLists=new WeakMap<HTMLMediaElement,EventTarget & {length:number;[Symbol.iterator]:()=>Iterator<never>}>();
Object.defineProperty(HTMLMediaElement.prototype,'audioTracks',{configurable:true,get(){
 let tracks=audioTrackLists.get(this);
 if(!tracks){tracks=Object.assign(new EventTarget(),{length:0,*[Symbol.iterator]():Generator<never>{}});audioTrackLists.set(this,tracks);}
 return tracks;
}});
}
