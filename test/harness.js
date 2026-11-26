// Minimal test registry (Node 15 has no built-in test runner).
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";

export const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zoomer-test-"));
}

export const quietLog = { debug() {}, info() {}, warn() {}, error() {} };

/** Local HTTP server; resolves { url, close }. */
export function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, server, close: () => new Promise((r) => server.close(r)) })
    );
  });
}
