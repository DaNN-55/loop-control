// @vitest-environment node
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {readHarnessHandoffPackage} from './harnessHandoffPackage';

const script='# 光落在杯沿\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n\n## 正文\n### 段落 01\n- 口播：把杯子放近一点。\n- 画面来源：图片\n- 素材名称：front.png\n- 镜头时长（秒）：2\n';
const manifest={schema:'loop-control-handoff/v1',handoff_id:'p01-001',revision:1,product_id:'P01',title:'光落在杯沿',product_images:['images/front.png']};
let root:string,version:string,image:Buffer;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'loop-handoff-package-'));version=join(root,'in','p01-001','v0001');
 await mkdir(join(version,'images'),{recursive:true});
 image=await readFile(new URL('./fixtures/workspace-media/still-striped.png',import.meta.url));
 await Promise.all([writeFile(join(version,'manifest.json'),JSON.stringify(manifest)),writeFile(join(version,'script.md'),script),writeFile(join(version,'images','front.png'),image)]);
});
afterEach(async()=>{if(root?.startsWith(join(tmpdir(),'loop-handoff-package-')))await rm(root,{recursive:true,force:true});});

it('receives an unmodified v3 script and reference image and fingerprints the exact inputs',async()=>{
 const read=()=>readHarnessHandoffPackage(root,'p01-001',1);
 const first=await read();
 expect(first).toMatchObject({manifest,script,parsed:{version:3,settings:{aspectRatio:'9:16'},segments:[{narration:'把杯子放近一点。',visualSource:'image'}]},images:[{name:'front.png',mimeType:'image/png',bytes:image}]});
 expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
 expect((await read()).digest).toBe(first.digest);
 await writeFile(join(version,'script.md'),script.replace('近一点','远一点'));
 expect((await read()).digest).not.toBe(first.digest);
});

it('rejects old prose, mismatched revisions, outside paths and files that are not images',async()=>{
 const read=()=>readHarnessHandoffPackage(root,'p01-001',1),setManifest=(patch:object)=>writeFile(join(version,'manifest.json'),JSON.stringify({...manifest,...patch}));
 await setManifest({revision:2});await expect(read()).rejects.toMatchObject({code:'invalid_manifest'});
 await setManifest({product_images:['images/../script.md']});await expect(read()).rejects.toMatchObject({code:'invalid_manifest'});
 await setManifest({});await writeFile(join(version,'script.md'),'## 脚本\n旧格式自由正文');await expect(read()).rejects.toMatchObject({code:'invalid_script'});
 await writeFile(join(version,'script.md'),script);await writeFile(join(version,'images','front.png'),image.subarray(0,20));
 await expect(read()).rejects.toMatchObject({code:'invalid_image'});
});

it('rejects symlinked references even if the target is a valid image',async()=>{
 const target=join(root,'outside.png');await writeFile(target,image);
 await setLinkedImage();
 await expect(readHarnessHandoffPackage(root,'p01-001',1)).rejects.toMatchObject({code:'invalid_image'});
 async function setLinkedImage(){const path=join(version,'images','front.png');await rm(path);await symlink(target,path);}
});
