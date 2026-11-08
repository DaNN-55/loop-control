/** Local sound vocabulary supplies editable search terms without another AI call. */
const soundTerms:Array<[RegExp,string]>=[
 [/泛音|空灵|灵动/, 'ethereal chime'],[/风铃/, 'wind chime'],[/钟声|铃声|门铃/, 'bell'],
 [/开门|关门|推门|门响/, 'door'],[/脚步|走路|奔跑/, 'footsteps'],[/鸟鸣|鸟叫/, 'birds chirping'],
 [/风声|山风|微风|大风/, 'wind'],[/雨声|下雨|雨滴/, 'rain'],[/雷声|打雷/, 'thunder'],
 [/流水|溪流|水声|河流/, 'water stream'],[/海浪|浪花/, 'ocean waves'],[/火焰|篝火|燃烧/, 'fire crackle'],
 [/纸张|纸条|翻页|撕纸/, 'paper rustle'],[/敲击|敲门/, 'knock'],[/撞击|碰撞|落地/, 'impact'],
 [/按键|键盘|打字/, 'keyboard typing'],[/转场|划过|掠过|呼啸/, 'whoosh'],[/爆炸/, 'explosion'],
 [/引擎|发动机/, 'engine'],[/掌声|鼓掌/, 'applause'],[/心跳/, 'heartbeat'],[/玻璃|破碎/, 'glass'],
];
export function soundIntentQuery(intent:string){
 const terms=soundTerms.filter(([pattern])=>pattern.test(intent)).map(([,query])=>query);
 if(terms.length)return [...new Set(terms)].slice(0,3).join(' ').slice(0,100);
 const english=intent.match(/[a-zA-Z][a-zA-Z'-]*/g)?.join(' ')??'';
 return english.slice(0,100);
}
