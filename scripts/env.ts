/**
 * Loads environment files for standalone scripts, in the same precedence
 * Next.js uses: `.env.local` overrides `.env`.
 *
 * `import "dotenv/config"` reads only `.env`, which meant a script would
 * silently ignore the DATABASE_URL in `.env.local` and fall back to an
 * in-memory database -- appearing to succeed while touching nothing real.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
