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
  // pg is an optional, lazily-imported dependency. Keeping it external means a
  // plan-only install/run never loads it. ponytail: external, not bundled.
  external: ["pg"],
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
]);
