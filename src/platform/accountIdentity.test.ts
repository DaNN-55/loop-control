import { describe, expect, it } from "vitest";
import { accountIdentityColor, accountIdentityInitials } from "./accountIdentity";

describe("账号身份标识", () => {
  it("为同一个账号稳定生成缩写和颜色", () => {
    expect(accountIdentityInitials("dao-studio")).toBe("DA");
    expect(accountIdentityColor("dao-studio")).toBe(accountIdentityColor("dao-studio"));
  });

  it("为空标识提供可读的默认缩写", () => {
    expect(accountIdentityInitials("")).toBe("??");
  });
});
