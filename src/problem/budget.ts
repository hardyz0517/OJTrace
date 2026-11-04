/** HTML bytes copied out of the page. Probe and snapshot share one source. */
export const PROBLEM_PROBE_HTML_LIMIT = 512_000;
export const PROBLEM_SNAPSHOT_HTML_LIMIT = 3_000_000;

/** Embedded statement images. The count limit applies only while capturing. */
export const IMAGE_SINGLE_BYTE_LIMIT = 512 * 1024;
export const IMAGE_TOTAL_BYTE_LIMIT = 2 * 1024 * 1024;
export const IMAGE_COUNT_LIMIT = 12;

/** Text/structure limits apply equally to direct export and editor parsing. */
export const PROBLEM_MARKDOWN_LIMIT = 2_000_000;
export const STATEMENT_HTML_LIMIT = 8_000_000;
export const STATEMENT_NODE_LIMIT = 100_000;
export const STATEMENT_DEPTH_LIMIT = 128;
export const TABLE_CELL_LIMIT = 10_000;
export const TABLE_SPAN_LIMIT = 256;
export const PROBLEM_DOCUMENT_LIMIT = 5_000_000;
