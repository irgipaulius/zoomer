import fetch from "node-fetch";
import dayjs from "dayjs";
import jwt from "jsonwebtoken";

export async function zoomFetcher(url, body) {
  if (!process.env.ZOOM_API_KEY || !process.env.ZOOM_API_SECRET) {
    throw new Error("No auth credentials set!");
  }

  const token = jwt.sign(
    {
      iss: process.env.ZOOM_API_KEY,
      exp: dayjs().add(2, "second").toDate().getTime(),
    },
    process.env.ZOOM_API_SECRET
  );

  const search = `${new URLSearchParams(body)}`;

  const res = await fetch(
    `https://api.zoom.us/v2${url}${search && `?${search}`}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Zoom-api-Jwt-Request",
        "content-type": "application/json",
      },
    }
  );

  return await res.json();
}
