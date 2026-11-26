import assert from "assert";
import { test } from "./harness.js";
import { testSetup } from "./setup.js";
import { createZoomClient } from "../src/zoom.js";

// Stand-in for got: no network.
function fakeHttp(pages, calls) {
  let tokens = 0;
  const http = (url, opts) => {
    calls.push({ url, ...opts });
    const page = opts.searchParams.next_page_token ? 1 : 0;
    return { json: async () => pages[page] };
  };
  http.post = (url, opts) => {
    calls.push({ url, ...opts });
    return { json: async () => ({ access_token: `tok${++tokens}`, expires_in: 3600 }) };
  };
  return http;
}

const file = (id, type, status = "completed") => ({ id, recording_type: type, status, file_extension: "MP4", download_url: `u/${id}`, file_size: 10 });

test("zoom: paginates, picks the preferred completed file, caches the token", async () => {
  const { cfg } = testSetup({ zoom: { accountId: "acc", clientId: "id", clientSecret: "sec" } });
  const calls = [];
  const pages = [
    { meetings: [{ topic: " A ", start_time: "2026-01-01T10:00:00Z", duration: 60, recording_files: [file("a1", "audio_only"), file("a2", "gallery_view")] }], next_page_token: "p2" },
    { meetings: [{ topic: "B", recording_files: [file("b1", "shared_screen_with_gallery_view", "processing"), file("b2", "active_speaker")] }, { topic: "C", recording_files: [] }] },
  ];
  const zoom = createZoomClient(cfg.zoom, { http: fakeHttp(pages, calls) });
  const recs = await zoom.listRecordings();
  assert.deepStrictEqual(recs.map((r) => [r.id, r.topic, r.type, r.ext]), [["a2", "A", "gallery_view", "mp4"], ["b2", "B", "active_speaker", "mp4"]]);
  assert.strictEqual(recs[0].durationS, 3600);
  const oauth = calls.filter((c) => c.username);
  assert.strictEqual(oauth.length, 1);
  assert.strictEqual(oauth[0].username, "id");
  assert.strictEqual(calls[1].headers.authorization, "Bearer tok1");
  assert.strictEqual(calls[1].searchParams.from, undefined);
});

test("zoom: lookbackDays sets from/to; token refreshes near expiry", async () => {
  const { cfg } = testSetup({ zoom: { lookbackDays: 7 } });
  let t = Date.parse("2026-03-10T12:00:00Z");
  const calls = [];
  const zoom = createZoomClient(cfg.zoom, { http: fakeHttp([{ meetings: [] }], calls), now: () => t });
  await zoom.listRecordings();
  assert.strictEqual(calls[1].searchParams.from, "2026-03-03");
  assert.strictEqual(calls[1].searchParams.to, "2026-03-10");
  t += 3600 * 1000 - cfg.zoom.tokenRefreshMarginMs + 1;
  assert.strictEqual(await zoom.getToken(), "tok2");
});
