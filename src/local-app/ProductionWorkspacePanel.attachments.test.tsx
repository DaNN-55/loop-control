import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const documentMaterial={id:'document',material_type:'reference',source_path:'notes.pdf',storage_path:'episodes/e/notes.pdf',mime_type:'application/pdf',is_main_script:false,material_purpose:'general_reference'};
vi.mock('./WorkspaceScriptPanel',()=>({WorkspaceScriptPanel:({onMaterialImported}:{onMaterialImported:(material:typeof documentMaterial)=>void})=><button data-testid="assistant-material-import" onClick={()=>onMaterialImported(documentMaterial)}>Import callback</button>}));
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('retains an assistant document as a document in the shelf before parent data refresh',async()=>{
 const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:'b',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'shot-S01-clip',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'episodes/e/project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S01-clip'],missingSources:[]},stale:false};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={vi.fn()} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByTestId('assistant-material-import'));
 fireEvent.click(screen.getByRole('button',{name:'本期素材 · 1'}));fireEvent.click(screen.getByRole('button',{name:'文档'}));
 const doc=within(screen.getByRole('list',{name:'素材清单'})).getByRole('button',{name:'预览 notes.pdf'});
 expect(doc).toHaveProperty('draggable',false);expect(doc.querySelector('img')).toBeNull();
});
