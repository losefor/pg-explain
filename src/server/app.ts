import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { type Context, Hono } from "hono";
import type { PgExplainConfig } from "../config.ts";
import { AppError, scrubCredentials } from "../diagnostics/diagnostic.ts";
import { apiRoutes } from "./routes/index.ts";
import type { Store } from "./store/sqlite.ts";

export interface AppOptions {
  /** Absolute path to the built SPA (dist/web). */
  webRoot: string;
  store: Store;
  config: PgExplainConfig;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

/**
 * The Hono app: a JSON `/api` surface + the static SPA with client-side-routing
 * fallback. Any thrown AppError becomes its actionable Diagnostic (credentials
 * scrubbed) so the UI shows the same guidance as the CLI.
 */
export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const webRoot = resolve(opts.webRoot);

  app.route("/", apiRoutes(opts.store, { current: opts.config }));

  // Turn thrown errors into the Diagnostic envelope the UI understands.
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const status = httpStatusFor(err.exitCode);
      return c.json({ error: scrubDiagnostic(err.diagnostic) }, status);
    }
    return c.json(
      {
        error: {
          code: "PGX_INTERNAL",
          severity: "error",
          title: "pgexplain hit an unexpected error",
          detail: scrubCredentials(err instanceof Error ? err.message : String(err)),
          remediation: {
            summary: "Retry; if it recurs, file an issue with the steps to reproduce.",
          },
        },
      },
      500,
    );
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json(
        { error: { code: "PGX_NOT_FOUND", title: "No such API route", detail: c.req.path } },
        404,
      );
    }
    return serveSpa(c, webRoot);
  });

  // Static assets + SPA fallback (anything not under /api).
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound();
    const file = await resolveStatic(webRoot, c.req.path);
    if (file) {
      return c.body(toBytes(file.body), 200, {
        "Content-Type": MIME[file.ext] ?? "application/octet-stream",
      });
    }
    return serveSpa(c, webRoot);
  });

  return app;
}

async function serveSpa(c: Context, webRoot: string): Promise<Response> {
  const index = await readFileSafe(join(webRoot, "index.html"));
  if (index) return c.body(toBytes(index), 200, { "Content-Type": "text/html; charset=utf-8" });
  return c.html(
    `<!doctype html><meta charset="utf-8"><title>pgexplain studio</title>
     <body style="font:15px system-ui;padding:3rem;max-width:40rem;margin:auto">
     <h1>UI not built</h1>
     <p>The studio UI bundle is missing at <code>${webRoot}</code>.</p>
     <p>Build it with <code>pnpm run build:web</code>, then restart <code>pg-explain studio</code>.</p>
     </body>`,
    200,
  );
}

/** Resolve a URL path to a file under webRoot, guarding against traversal. */
async function resolveStatic(
  webRoot: string,
  urlPath: string,
): Promise<{ body: Uint8Array; ext: string } | null> {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const full = join(webRoot, rel);
  if (!full.startsWith(webRoot)) return null; // traversal attempt
  try {
    if (!(await stat(full)).isFile()) return null;
  } catch {
    return null;
  }
  const body = await readFileSafe(full);
  return body ? { body, ext: extname(full) } : null;
}

/** Copy a possibly-pooled Buffer into a standalone ArrayBuffer hono will accept as a body. */
function toBytes(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

async function readFileSafe(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function httpStatusFor(exitCode: number): 400 | 401 | 404 | 408 | 422 | 500 | 502 {
  // ExitCode: 2 usage, 3 input, 4 parse, 5 database, 70 internal.
  switch (exitCode) {
    case 2:
      return 400;
    case 3:
    case 4:
      return 422;
    case 5:
      return 502;
    default:
      return 500;
  }
}

function scrubDiagnostic(d: unknown): unknown {
  const json = JSON.stringify(d);
  return JSON.parse(scrubCredentials(json));
}
