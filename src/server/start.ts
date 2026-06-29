import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readStudioConfig } from "./settings.ts";
import { openStore } from "./store/sqlite.ts";

export interface StudioServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface StartOptions {
  host: string;
  port: number;
  /** Override the SPA root (defaults to dist/web next to this bundle). */
  webRoot?: string;
}

/**
 * Boot the studio HTTP server. This module is built as its own bundle
 * (dist/server.js) and dynamically imported, so hono + better-sqlite3 never load
 * for plain CLI use and a broken native module can't break `pg-explain analyze`.
 */
export async function startStudio(opts: StartOptions): Promise<StudioServer> {
  // At runtime this file is dist/server.js, so ./web resolves to dist/web.
  const webRoot = opts.webRoot ?? fileURLToPath(new URL("./web", import.meta.url));
  const app = createApp({ webRoot, store: openStore(), config: await readStudioConfig() });

  return new Promise((resolvePromise) => {
    const server = serve({ fetch: app.fetch, hostname: opts.host, port: opts.port }, (info) => {
      resolvePromise({
        url: `http://${displayHost(opts.host)}:${info.port}`,
        port: info.port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

function displayHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "localhost" : host;
}
