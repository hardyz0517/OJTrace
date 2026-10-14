/** HTML bytes copied out of the page. Probe and snapshot share one source. */
export const PROBLEM_PROBE_HTML_LIMIT = 512_000;
export const PROBLEM_SNAPSHOT_HTML_LIMIT = 3_000_000;

/** Embedded statement images. The count limit applies only while capturing. */
export const IMAGE_SINGLE_BYTE_LIMIT = 512 * 1024;
export const IMAGE_TOTAL_BYTE_LIMIT = 2 * 1024 * 1024;
export const IMAGE_COUNT_LIMIT = 12;
