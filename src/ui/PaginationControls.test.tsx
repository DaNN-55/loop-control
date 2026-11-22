import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaginationControls } from "./PaginationControls";

describe("分页控件", () => {
  it("显示页码和总数，并允许切换页码", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<PaginationControls page={2} pageSize={20} total={45} onPageChange={onPageChange} />);

    expect(screen.getByText("第 2 / 3 页 · 共 45 条")).toBeTruthy();
    expect((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("只有一页时不渲染控件", () => {
    const { container } = render(<PaginationControls page={1} pageSize={20} total={2} onPageChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

it('groups totals with numbered navigation and exposes the current page without resubmitting it',async()=>{
 const onPageChange=vi.fn();
 const {container}=render(<PaginationControls numbered page={5} pageSize={10} total={86} onPageChange={onPageChange} pageSizeControl={<select aria-label="每页条数"><option>10 条 / 页</option></select>}/>);
 expect(screen.getByText('共 86 条')).toBeTruthy();
 expect(screen.getByRole('button',{name:'第 5 页'}).getAttribute('aria-current')).toBe('page');
 expect(container.querySelectorAll('.pagination-gap')).toHaveLength(2);
 expect(screen.getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(['上一页','第 1 页','第 4 页','第 5 页','第 6 页','第 9 页','下一页']);
 await userEvent.click(screen.getByRole('button',{name:'第 5 页'}));expect(onPageChange).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'第 9 页'}));expect(onPageChange).toHaveBeenCalledWith(9);
});

it.each([0,8])('keeps numbered pagination for %s rows with correct disabled boundaries',async(total)=>{
 const onPageChange=vi.fn();
 render(<PaginationControls numbered page={1} pageSize={20} total={total} onPageChange={onPageChange}/>);
 expect(screen.getByText(`共 ${total} 条`)).toBeTruthy();
 for(const name of ['上一页','下一页'])expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'第 1 页'}).getAttribute('aria-current')).toBe('page');
 await userEvent.click(screen.getByRole('button',{name:'第 1 页'}));expect(onPageChange).not.toHaveBeenCalled();
});

it('keeps page choices bounded for large catalogs and disables next at the last page',()=>{
 const app=render(<PaginationControls numbered page={1_000_000} pageSize={10} total={10_000_000} onPageChange={vi.fn()}/>);
 expect(screen.getAllByRole('button').length).toBeLessThanOrEqual(7);
 expect((screen.getByRole('button',{name:'下一页'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'第 1000000 页'}).getAttribute('aria-current')).toBe('page');
 app.rerender(<PaginationControls numbered page={1} pageSize={10} total={86} onPageChange={vi.fn()}/>);
 expect((screen.getByRole('button',{name:'上一页'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'第 9 页'})).toBeTruthy();
});
