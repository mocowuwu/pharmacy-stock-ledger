import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";

/**
 * Every literal message key the code asks for exists, as text, in both
 * catalogues.
 *
 * The parity test says the two catalogues have the same keys; it cannot say
 * the code asks for keys that are there. A missing key renders as its own
 * name -- "reports.export" on a button -- which no type check catches, and
 * that happened once when a label and a group of labels were given the same
 * key. Keys built at run time (`t(\`nav.${key}\`)`) are not checked here; the
 * catalogues' enum sections are what they read.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs)$/u.test(name) && !/\.test\./u.test(name) ? [path] : [];
  });
}

function lookup(messages: unknown, key: string): unknown {
  let node = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const KEY_CALL = /\bt\(\s*(["'`])([a-zA-Z][\w]*(?:\.[\w]+)+)\1/gu;

describe("message keys used in code", () => {
  // key -> the file it came from, and the namespaces a translator in that file
  // was scoped to (`useTranslations("tutorial")` reads "tutorial.<key>").
  const used = new Map<string, { file: string; namespaces: string[] }>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    const namespaces = [...text.matchAll(/(?:use|get)Translations\(\s*["'`]([\w.]+)["'`]/gu)].map((m) => m[1]);
    for (const match of text.matchAll(KEY_CALL)) {
      // A template literal with an interpolation is a run-time key.
      if (match[1] === "`" && match[2].includes("${")) continue;
      used.set(match[2], { file, namespaces });
    }
  }

  it("finds the keys to check", () => {
    expect(used.size).toBeGreaterThan(300);
  });

  for (const [name, messages] of [
    ["id", id],
    ["en", en],
  ] as const) {
    it(`resolves every one of them to text in ${name}`, () => {
      const missing = [...used]
        .filter(
          ([key, { namespaces }]) =>
            typeof lookup(messages, key) !== "string" &&
            !namespaces.some((ns) => typeof lookup(messages, `${ns}.${key}`) === "string"),
        )
        .map(([key, { file }]) => `${key} (${file})`);
      expect(missing).toEqual([]);
    });
  }
});
