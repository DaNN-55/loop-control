/** Human names for newly created nodes; native IDs and user names stay untouched. */
export function workspaceShotMediaName(shotId:string,kind:'narration'|'source'|'ambience'|'visual',order?:readonly string[]){
 const index=order?[...new Set(order)].indexOf(shotId):-1;
 const ordinal=index>=0?String(index+1):shotId.match(/^(?:shot-|s)([0-9]+)$/i)?.[1];
 const shot=ordinal===undefined?'镜头':`镜头 ${ordinal.padStart(2,'0')}`;
 return `${shot} ${{narration:'口播',source:'原声',ambience:'环境声',visual:'画面'}[kind]}`;
}
