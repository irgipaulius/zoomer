import assert from "assert";
import fs from "fs";
import path from "path";
import { test, tmpDir, serve } from "./harness.js";
import { downloadFile } from "../src/download.js";

const BODY = Buffer.from("0123456789".repeat(1000));
const opts = { idleTimeoutMs: 1000, timeoutMs: 5000 };

function server(seen) {
  return serve((req, res) => {
    seen.push(req.headers.authorization);
    if (req.url === "/404") return res.writeHead(404), res.end();
    if (req.url === "/html") return res.writeHead(200, { "content-type": "text/html" }), res.end("<html>sign in</html>");
    if (req.url === "/stall") return res.writeHead(200, { "content-type": "video/mp4" }), res.write("x");
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end(BODY);
  });
}

test("download: .part then rename, size checked, bearer sent, existing file kept", async () => {
  const seen = [];
  const s = await server(seen);
  const dest = path.join(tmpDir(), "sub", "a.mp4");
  try {
    assert.strictEqual(await downloadFile({ ...opts, url: `${s.url}/ok`, dest, token: "T", size: BODY.length }), BODY.length);
    assert.ok(fs.readFileSync(dest).equals(BODY));
    assert.ok(!fs.existsSync(dest + ".part"));
    assert.strictEqual(seen[0], "Bearer T");
    assert.strictEqual(await downloadFile({ ...opts, url: `${s.url}/404`, dest }), BODY.length);
  } finally {
    await s.close();
  }
});

test("download: HTTP error, HTML page, size mismatch, stall all fail and leave nothing", async () => {
  const s = await server([]);
  const dir = tmpDir();
  try {
    await assert.rejects(downloadFile({ ...opts, url: `${s.url}/404`, dest: path.join(dir, "a") }), /404/);
    await assert.rejects(downloadFile({ ...opts, url: `${s.url}/html`, dest: path.join(dir, "b") }), /HTML page/);
    await assert.rejects(downloadFile({ ...opts, url: `${s.url}/ok`, dest: path.join(dir, "c"), size: 5 }), /size mismatch/);
    await assert.rejects(downloadFile({ ...opts, url: `${s.url}/stall`, dest: path.join(dir, "d"), idleTimeoutMs: 200 }), /timeout/i);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally {
    s.close(); // the stalled connection is dropped when the test process exits
  }
});
