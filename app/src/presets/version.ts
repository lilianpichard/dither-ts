/**
 * The one place the preset schema version is declared. It lives apart from
 * schema.ts so the legacy migrator can stamp a version without importing the
 * parser that calls it, and it is never re-exported: import it from here.
 */
export const PRESET_VERSION = 1;
