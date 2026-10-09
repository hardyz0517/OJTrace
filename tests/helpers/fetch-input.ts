import type { PaginationRuntime } from "../../src/domain/adapter";

/** Only adapter unit fixtures bypass delays; queue tests use the real runtime. */
export function immediatePagination(): PaginationRuntime {
  return { runPage: ({ request }) => request() };
}
