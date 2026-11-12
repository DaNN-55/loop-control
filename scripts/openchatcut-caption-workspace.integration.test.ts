// @vitest-environment node
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {it,expect} from 'vitest';
const root=process.env.OPENCHATCUT_ROOT;
if(!root)throw Error('Caption workspace integration requires OPENCHATCUT_ROOT.');
it('leaves the actual native subtitle workspace and manual editing controls unmodified',()=>{
 const adapter=readFileSync('scripts/openchatcut-embedded.mjs','utf8');
 const source=adapter.slice(adapter.indexOf('const bridge='),adapter.indexOf('const {createServer'));
 const bridge=new Function(source+'\nreturn bridge;')();
 for(const module of ['captions/CaptionsPanel.tsx','captions/CaptionsControls.tsx','captions/ManualCaptionEditor.tsx','library/LibraryPanel.tsx']){
  const native=readFileSync(join(root,'src',module),'utf8');
  expect(bridge.transform(native,'/sdk/src/'+module)).toBeUndefined();
 }
 expect(readFileSync(join(root,'src/captions/CaptionsPanel.tsx'),'utf8')).toContain('<CaptionsControls captionTrackId=');
 const client=readFileSync('scripts/openchatcut-embed-client.mjs','utf8');
 expect(client).not.toContain('LoopControlCaptionAlignment');expect(client).not.toContain('caption-alignment-requested');expect(client).not.toContain('host-panel');
});
