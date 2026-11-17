// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.luogu.com.cn/record/list?pid=CF1A"}
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markLuoguUserCardTrigger,
  mountLuoguUserCard,
  parseLuoguUserCardProfile,
} from "../../src/oj-enhancer/features/cross-oj-submit/luogu-user-card";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head
    .querySelectorAll("[data-ojtrace-luogu-user-card-style]")
    .forEach((element) => element.remove());
});

describe("Luogu user hover cards", () => {
  it("parses only the matching public profile and bounds remote image origins", () => {
    const parsed = parseLuoguUserCardProfile(
      JSON.stringify({
        data: {
          user: {
            uid: 981551,
            name: "DGFLSzfd",
            avatar: "https://cdn.luogu.com.cn/upload/usericon/981551.png",
            background:
              "https://cdn.luogu.com.cn/upload/image_hosting/cover.png",
            slogan: "Hello",
            followingCount: 38,
            followerCount: 308,
            ranking: 64,
          },
          elo: [{ rating: 1527, latest: true }],
        },
      }),
      981551,
    );

    expect(parsed).toEqual({
      uid: 981551,
      name: "DGFLSzfd",
      avatar: "https://cdn.luogu.com.cn/upload/usericon/981551.png",
      background: "https://cdn.luogu.com.cn/upload/image_hosting/cover.png",
      slogan: "Hello",
      followingCount: 38,
      followerCount: 308,
      ranking: 64,
      eloValue: 1527,
    });
    expect(
      parseLuoguUserCardProfile(
        JSON.stringify({ data: { user: { uid: 7, name: "other" } } }),
        981551,
      ),
    ).toBeUndefined();
  });

  it("loads a public profile on keyboard focus and renders a native float card", async () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="user"><img class="avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png">
          <div class="luogu-username"><a href="/user/981551" style="font-weight:bold;color:var(--lfe-color--pink-3)">DGFLSzfd</a><a href="https://help.luogu.com.cn/manual/luogu/account/award-certify" target="_blank"><svg class="fa-badge-check"></svg></a></div>
        </div>
      </div>`;
    const link =
      document.querySelector<HTMLAnchorElement>(".luogu-username a")!;
    markLuoguUserCardTrigger(link);
    const payload = JSON.stringify({
      data: {
        user: {
          uid: 981551,
          name: "DGFLSzfd",
          avatar: "https://cdn.luogu.com.cn/upload/usericon/981551.png",
          slogan: "公开签名",
          followingCount: 38,
          followerCount: 308,
          ranking: 64,
          eloValue: 1527,
        },
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      text: async () => payload,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const dispose = mountLuoguUserCard();

    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const card = document.querySelector<HTMLElement>(
      "[data-ojtrace-luogu-user-card]",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      new URL(fetchMock.mock.calls[0]![0].toString()).searchParams.get(
        "_contentOnly",
      ),
    ).toBe("1");
    expect(card?.classList.contains("dropdown")).toBe(true);
    expect(card?.classList.contains("shown")).toBe(true);
    expect(card?.querySelector(".l-card.float-card")).not.toBeNull();
    expect(card?.dataset.state).toBe("ready");
    expect(card?.textContent).toContain("公开签名");
    expect(card?.textContent).toContain("粉丝");
    expect(card?.textContent).toContain("308");
    expect(card?.textContent).toContain("等级分");
    expect(card?.querySelector(".fa-badge-check")).not.toBeNull();
    expect(link.getAttribute("aria-describedby")).toBe(
      "ojtrace-luogu-user-card",
    );
    expect(document.querySelector("#app [data-ojtrace-luogu-user-card]")).toBe(
      card,
    );

    dispose();
    expect(document.querySelector("[data-ojtrace-luogu-user-card]")).toBeNull();
    expect(link.hasAttribute("aria-describedby")).toBe(false);
  });

  it("follows Luogu hover delay and fades in without sliding", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    document.body.innerHTML = `
      <div class="user"><img class="avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png">
        <div class="luogu-username"><a href="/user/981551">DGFLSzfd</a></div>
      </div>`;
    const link =
      document.querySelector<HTMLAnchorElement>(".luogu-username a")!;
    markLuoguUserCardTrigger(link);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: {
              user: { uid: 981551, name: "DGFLSzfd", slogan: "公开签名" },
            },
          }),
      })),
    );
    const dispose = mountLuoguUserCard();
    const card = document.querySelector<HTMLElement>(
      "[data-ojtrace-luogu-user-card]",
    )!;
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });

    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(card.classList.contains("shown")).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(card.classList.contains("shown")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(card.classList.contains("shown")).toBe(true);
    expect(card.style.opacity).toBe("0");
    expect(card.style.top).not.toMatch(/^-/);
    frames.shift()?.(0);
    expect(card.style.opacity).toBe("1");

    link.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    expect(card.classList.contains("shown")).toBe(true);
    await vi.advanceTimersByTimeAsync(79);
    expect(card.classList.contains("shown")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(card.classList.contains("shown")).toBe(false);
    expect(card.style.opacity).toBe("0");

    raf.mockRestore();
    dispose();
  });
});
