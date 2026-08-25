import { describe, expect, it } from "vitest";
import type { AutomatedPublicationAdapter } from "./publicationAdapter";
import { automatedPublicationResult } from "./publicationAdapter";

describe("自动发布适配器边界", () => {
  it("适配器只返回统一发布记录，不在控制台执行第三方动作", async () => {
    const adapter: AutomatedPublicationAdapter = {
      adapterId: "future-platform-adapter",
      async publish(input) {
        return automatedPublicationResult(this.adapterId, input);
      },
    };

    const result = await adapter.publish({
      episodeId: "episode-1",
      externalContentId: "content-1",
      externalUrl: "https://example.com/content-1",
      notes: "适配器结果",
      platform: "Example",
      publishedAt: "2026-08-18T03:00:00.000Z",
      publishingAccount: "dao.main",
    });

    expect(result).toMatchObject({ adapter: "future-platform-adapter", episodeId: "episode-1", source: "automated", status: "published" });
  });
});
