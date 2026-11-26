import fs from "fs";
import path from "path";
import stream from "stream";
import { promisify } from "util";
import got from "got";

const pipeline = promisify(stream.pipeline);

/**
 * Download to <dest>.part and rename only when complete (and the size matches,
 * if known). Sends the Zoom token as a Bearer header; got drops it on
 * cross-host redirects. Returns the byte count.
 */
export async function downloadFile({ url, dest, token, size, idleTimeoutMs, timeoutMs, http = got }) {
  if (fs.existsSync(dest)) return fs.statSync(dest).size; // only ever created by the rename below
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  const closed = new Promise((resolve) => out.once("close", resolve));
  try {
    const req = http.stream(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      retry: 0,
      timeout: { socket: idleTimeoutMs, request: timeoutMs },
    });
    req.on("response", (res) => {
      if (String(res.headers["content-type"]).includes("text/html")) {
        req.destroy(new Error(`got an HTML page instead of a recording (HTTP ${res.statusCode}); auth problem or expired link?`));
      }
    });
    await pipeline(req, out);
    const bytes = fs.statSync(part).size;
    if (size && bytes !== size) throw new Error(`size mismatch: got ${bytes} bytes, Zoom reported ${size}`);
    fs.renameSync(part, dest);
    return bytes;
  } catch (e) {
    await closed; // the stream may still be opening the file; remove it only after
    fs.rmSync(part, { force: true });
    throw e;
  }
}
