import got from "got";
import dayjs from "dayjs";

/** Zoom S2S OAuth client: cached token, paginated recording list. */
export function createZoomClient(z, { http = got, now = Date.now } = {}) {
  let cached = null;
  const timeout = { request: z.requestTimeoutMs };

  async function getToken() {
    if (cached && now() < cached.expiresAt - z.tokenRefreshMarginMs) return cached.token;
    const res = await http
      .post(z.oauthUrl, {
        searchParams: { grant_type: "account_credentials", account_id: z.accountId },
        username: z.clientId,
        password: z.clientSecret,
        timeout,
      })
      .json();
    cached = { token: res.access_token, expiresAt: now() + res.expires_in * 1000 };
    return cached.token;
  }

  async function listRecordings() {
    const searchParams = { page_size: z.pageSize };
    if (z.lookbackDays > 0) {
      searchParams.from = dayjs(now()).subtract(z.lookbackDays, "day").format("YYYY-MM-DD");
      searchParams.to = dayjs(now()).format("YYYY-MM-DD");
    }
    const meetings = [];
    let page = "";
    do {
      const headers = { authorization: `Bearer ${await getToken()}` };
      const res = await http(`${z.apiUrl}/users/${z.userId}/recordings`, {
        searchParams: page ? { ...searchParams, next_page_token: page } : searchParams,
        headers,
        timeout,
      }).json();
      meetings.push(...(res.meetings || []));
      page = res.next_page_token || "";
    } while (page);

    return meetings
      .map((m) => {
        const files = (m.recording_files || []).filter((f) => f.status === "completed");
        const type = z.fileTypePreference.find((t) => files.some((f) => f.recording_type === t));
        const f = files.find((x) => x.recording_type === type);
        return (
          f && {
            id: f.id,
            topic: `${m.topic}`.trim(),
            startTime: m.start_time,
            durationS: m.duration ? m.duration * 60 : null,
            type,
            ext: String(f.file_extension).toLowerCase(),
            size: f.file_size || null,
            url: f.download_url,
          }
        );
      })
      .filter(Boolean);
  }

  return { getToken, listRecordings };
}
