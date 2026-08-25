import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders the generated headings, quote, list and inline emphasis", () => {
    render(<MarkdownPreview content={"# 视觉参考组 v1\n\n> 只补充本集新增方向。\n\n## 人物 Character\n\n- **身份/作用**：主视角\n- `visual_reference_group`"} />);

    expect(screen.getByRole("heading", { level: 1, name: "视觉参考组 v1" })).toBeTruthy();
    expect(screen.getByRole("blockquote").textContent).toContain("只补充本集新增方向。");
    expect(screen.getByRole("heading", { level: 2, name: "人物 Character" })).toBeTruthy();
    expect(screen.getByText("身份/作用")).toBeTruthy();
    expect(screen.getByText("visual_reference_group")).toBeTruthy();
    expect(screen.queryByText("# 视觉参考组 v1")).toBeNull();
  });
});
