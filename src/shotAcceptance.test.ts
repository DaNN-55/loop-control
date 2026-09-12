import { describe, expect, it } from "vitest";
import { nextUnconfirmedShotId } from "./shotAcceptance";

describe("逐镜头确认推进", () => {
  it("只打开当前镜头之后的下一条未确认镜头", () => {
    expect(nextUnconfirmedShotId(["shot-1", "shot-2", "shot-3"], "shot-1", new Set(["shot-1", "shot-2"]))).toBe("shot-3");
  });

  it("到末尾时回到前面仍未确认的镜头，而不打开已确认镜头", () => {
    expect(nextUnconfirmedShotId(["shot-1", "shot-2", "shot-3"], "shot-3", new Set(["shot-2", "shot-3"]))).toBe("shot-1");
  });

  it("全部真实确认后不再打开任何镜头", () => {
    expect(nextUnconfirmedShotId(["shot-1", "shot-2"], "shot-1", new Set(["shot-1", "shot-2"]))).toBeNull();
  });
});
