import { expect, it } from "vitest";
import { createKeyedSerialQueue } from "../../src/platform/async/serial-queue";
import { deferred } from "../helpers/deferred";

it("holds a key through settlement and continues after undefined rejection", async () => {
  const run = createKeyedSerialQueue();
  const pending = deferred<void>();
  const events: string[] = [];
  const first = run("origin", () => pending.promise);
  const rejected = first.catch((error: unknown) => {
    events.push("failed");
    expect(error).toBeUndefined();
  });
  const second = run("origin", async () => {
    events.push("next");
    return 2;
  });
  await run("other", async () => {
    events.push("other");
  });
  expect(events).toEqual(["other"]);
  pending.reject(undefined);
  await rejected;
  expect(await second).toBe(2);
  expect(events).toEqual(["other", "failed", "next"]);
});

it("keeps Cookie and instance-session queue owners independent", async () => {
  const cookie = createKeyedSerialQueue();
  const session = createKeyedSerialQueue();
  expect(
    await session("origin", () => cookie("origin", async () => "nested")),
  ).toBe("nested");
});
