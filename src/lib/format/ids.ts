/**
 * Record ids are UUIDs, and they arrive from URLs and form fields that anyone
 * can type into. Postgres refuses a malformed one with a syntax error, which a
 * page would surface as a server error; checked here first, a mistyped or
 * truncated link is simply "not found".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
