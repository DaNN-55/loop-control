import { describe, expect, it } from "vitest";
import { createAutomatedPublicationRecord, createManualPublicationRecord } from "./publicationRecord";

describe("发布记录", () => {
  it("规范化手工发布记录并保留可追溯字段", () => {
    expect(createManualPublicationRecord({
      episodeId: "episode-1",
      externalContentId: "content-123",
      externalUrl: "https://www.tiktok.com/@dao/video/123",
      notes: "已核对视频、封面和标题。",
      platform: " TikTok ",
      publishedAt: "2026-08-18T03:00:00.000Z",
      publishingAccount: " dao.main ",
    })).toEqual({
      adapter: null,
      episodeId: "episode-1",
      externalContentId: "content-123",
      externalUrl: "https://www.tiktok.com/@dao/video/123",
      notes: "已核对视频、封面和标题。",
      platform: "TikTok",
      publishedAt: "2026-08-18T03:00:00.000Z",
      source: "manual",
      status: "published",
      publishingAccount: "dao.main",
    });
  });

  it("要求已发布记录至少留下一个外部定位信息", () => {
    expect(() => createManualPublicationRecord({
      episodeId: "episode-1",
      externalContentId: "",
      externalUrl: "",
      notes: "已发布。",
      platform: "TikTok",
      publishedAt: "2026-08-18T03:00:00.000Z",
      publishingAccount: "dao.main",
    })).toThrow("外部 URL 或内容 ID");
  });

  it("自动发布适配器写入同一记录形状并标记来源", () => {
    expect(createAutomatedPublicationRecord("tiktok-adapter-v1", {
      episodeId: "episode-1",
      externalContentId: "content-456",
      externalUrl: "https://www.tiktok.com/@dao/video/456",
      notes: "适配器回报发布成功。",
      platform: "TikTok",
      publishedAt: "2026-08-18T03:01:00.000Z",
      publishingAccount: "dao.main",
    })).toMatchObject({ adapter: "tiktok-adapter-v1", source: "automated", status: "published" });
  });
});
