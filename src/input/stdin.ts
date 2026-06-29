/** Read all of stdin to a string, with a timeout so an idle pipe can't hang the tool. */
export function readStdin(timeoutMs = 30_000): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      process.stdin.pause();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for stdin`));
    }, timeoutMs);

    process.stdin
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
