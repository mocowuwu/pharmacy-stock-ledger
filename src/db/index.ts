import "server-only";

/**
 * Server-side entry point to the database.
 *
 * The connection itself lives in `./client` so that standalone scripts can use
 * it; this module exists to make importing the database from anything that
 * could end up in a client bundle a build error rather than a leak.
 */
export * from "./client";
