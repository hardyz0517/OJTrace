import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderDocument } from "../../src/problem/domain";
const render = vi.hoisted(() => vi.fn());
vi.mock("../../src/problem/render/worker-problem-renderer", () => ({
  WorkerProblemRenderer: class {
    pdf = render;
    dispose = vi.fn();
  },
}));
import { OffscreenPdfRenderer } from "../../entrypoints/pdf-worker/renderer";

const document: RenderDocument = {
  oj: "luogu",
  problemId: "P1001",
  title: "A/B",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  ast: { type: "root" as const, children: [] },

  assets: [],
  warnings: [],
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("offscreen PDF renderer", () => {
  it("uses the shared renderer and keeps the PDF Blob until explicitly released", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    render.mockResolvedValue(
      new Uint8Array([0, 0x25, 0x50, 0x44, 0x46, 0x2d, 0]).subarray(1, 6),
    );
    const worker = new OffscreenPdfRenderer();
    await expect(worker.render("token", document)).resolves.toEqual({
      ok: true,
      url: "blob:pdf",
      filename: "P1001-AB.pdf",
    });
    expect(render).toHaveBeenCalledWith(document);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      type: "application/pdf",
      size: 5,
    });
    expect(revoke).not.toHaveBeenCalled();
    await expect(worker.render("other", document)).resolves.toMatchObject({
      ok: false,
    });
    worker.release("wrong");
    expect(revoke).not.toHaveBeenCalled();
    worker.release("token");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:pdf");
    await expect(worker.render("next", document)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("returns a diagnostic and never creates a Blob for invalid PDF bytes or compile failure", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    render.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const worker = new OffscreenPdfRenderer();
    await expect(worker.render("invalid", document)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("PDF 数据校验失败"),
    });
    render.mockRejectedValueOnce(new Error("font unavailable"));
    await expect(worker.render("failed", document)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("font unavailable"),
    });
    expect(create).not.toHaveBeenCalled();
  });
});
