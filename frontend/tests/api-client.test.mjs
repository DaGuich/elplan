import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("API errors retain HTTP status so missing resources differ from failures", async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: () => null };
  try {
    for (const status of [404, 503]) {
      globalThis.fetch = async () => new Response("unavailable", { status });
      await assert.rejects(api("/test"), (error) =>
        error instanceof ApiError && error.status === status && error.message === "unavailable"
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});
