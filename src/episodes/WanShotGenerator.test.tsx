import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WanShotGenerator } from "./WanShotGenerator";
import type { Database } from "../lib/database.types";
const mocks = vi.hoisted(() => ({ command: vi.fn(), request: vi.fn().mockResolvedValue({budget:null,usedCents:0}) }));
vi.mock("../local-app/client", () => ({ localCommand: mocks.command, localRequest: mocks.request }));
const props = { episodeId: "episode", reviewPackageId: "review", shot: { id: "shot-01", shotType: "a_roll", productionMethod: "轻微转身" }, materials: [{ id: "image", material_type: "image", source_path: "男主.png" }] as Database["public"]["Tables"]["production_material_revisions"]["Row"][], tasks: [], onRefresh: vi.fn().mockResolvedValue(undefined) };
describe('Wan shot generation without account ceilings',()=>{
 beforeEach(()=>{mocks.command.mockReset();mocks.command.mockResolvedValue({id:'task'});mocks.request.mockClear();});
 it('人工路径不出现生成入口',()=>{render(<WanShotGenerator {...props} blueprint={{a_roll:{execution_path:'manual'}}}/>);expect(screen.queryByText('生成 AI 视频')).toBeNull();});
 it('multiple shot generators expose generation but no account or trial budget editor',()=>{
  const blueprint={a_roll:{execution_path:'external',executor:{provider:'bailian'}},b_roll:{execution_path:'external',executor:{provider:'bailian'}}};
  render(<><WanShotGenerator {...props} blueprint={blueprint}/><WanShotGenerator {...props} shot={{...props.shot,id:'shot-02',shotType:'b_roll'}} blueprint={blueprint}/></>);
  expect(screen.getAllByRole('button',{name:'生成 AI 视频'})).toHaveLength(2);expect(screen.queryByText(/试片上限|总上限|生成预算/)).toBeNull();expect(mocks.request).not.toHaveBeenCalled();
 });
});
