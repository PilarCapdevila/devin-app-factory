/**
 * Node module-customization hooks (registered from ./platform.ts) that make the application's
 * ESM-only TypeScript under src/ loadable from the test worker without any bundler:
 *
 *  - resolve: the app uses extensionless imports ("./enums", and the tsconfig alias "@/x" for
 *    src/x), so those are completed to the matching `.ts` file;
 *  - load: `.ts` files under src/ are type-stripped with Node's built-in transformer.
 *
 * Only URLs under src/ are touched; everything else falls through to the next loader
 * (Playwright's own transform for the spec files).
 */
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, type LoadHook, type ResolveHook } from "node:module";
import { fileURLToPath } from "node:url";

const SRC_URL = new URL("../../../src/", import.meta.url).href;

function isFile(url: string): boolean {
  const file = fileURLToPath(url);
  return existsSync(file) && statSync(file).isFile();
}

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
  if (context.parentURL?.startsWith(SRC_URL) && (specifier.startsWith(".") || specifier.startsWith("@/"))) {
    const base = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), SRC_URL).href
      : new URL(specifier, context.parentURL).href;
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (isFile(candidate)) return { url: candidate, format: "module", shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
};

export const load: LoadHook = async (url, context, nextLoad) => {
  if (url.startsWith(SRC_URL) && url.endsWith(".ts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url, sourceMap: true }),
    };
  }
  return nextLoad(url, context);
};
