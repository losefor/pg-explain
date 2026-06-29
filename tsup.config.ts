import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  treeshake: true,
  dts: true,
  sourcemap: true,
  minify: false,
  // pg is optional + lazily imported; the studio server deps are native/heavy and
  // only loaded by `pg-explain studio`. External = resolved at runtime, not bundled.
  external: ["pg", "better-sqlite3", "hono", "@hono/node-server"],
};

export default defineConfig([
  {
    ...shared,
    entry: { cli: "src/cli.ts" },
    clean: true,
    // Shebang only on the executable entry, never on the library bundle.
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entry: { index: "src/index.ts" },
    clean: false,
  },
  {
    // The studio server: its own bundle so hono + better-sqlite3 load only when
    // `pg-explain studio` runs (dynamically imported by URL from the CLI).
    ...shared,
    entry: { server: "src/server/start.ts" },
    clean: false,
    dts: false,
  },
]);
