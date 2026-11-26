# Zoomer worker protocol v1 (shared contract between zoomer and zoomer-transcriber)

Zoomer owns the schedule and the job queue. Transcription is an optional job type that Zoomer
queues after a recording is downloaded (if transcription is enabled in Zoomer's config).
External workers (zoomer-transcriber, installed anywhere: cloud, local, jail) PULL jobs over HTTP.
Zoomer never connects to workers. Everything below is configurable in Zoomer's config
(enable flag, bind host/port, base path, tokens, lease length, max attempts, which models/languages
to request by default, where transcripts are stored).

Auth: `Authorization: Bearer <worker token>` (token(s) from Zoomer config / env). HTTPS is expected
to be provided by a reverse proxy; the API itself binds to a configurable host:port.

Base path default: /api/v1

- GET  /health                              -> 200 {"ok":true,"version":...}
- POST /jobs/claim   body {"worker_id": str, "types": ["transcribe"], "capabilities": {"models": [...], "languages": [...]}}
      -> 200 {job} or 204 when none. job = {
           "id": str, "type": "transcribe", "lease_id": str, "lease_expires_at": ISO8601,
           "recording": {"id": str, "topic": str, "start_time": ISO8601, "duration_s": int|null},
           "media": {"url": "<zoomer base>/api/v1/jobs/{id}/media", "filename": str, "size": int|null, "content_type": str},
           "options": {"language": str|null, "models": [str] | "default" | "all", "formats": ["txt","srt","vtt","json"]},
           "done_models": [str]   # models already delivered on an earlier attempt; worker skips them
         }
- POST /jobs/{id}/heartbeat body {"lease_id"} -> 200 {"lease_expires_at"} | 409 lease lost
- GET  /jobs/{id}/media  (worker token; supports HTTP Range) -> the recording file
- POST /jobs/{id}/results body {"lease_id","model","language","text","segments":[{"start","end","text"}],
                                 "srt","vtt","settings":{...},"timing":{"audio_s","wall_s"},"worker_id"} -> 200 | 409
- POST /jobs/{id}/complete body {"lease_id"} -> 200 | 409
- POST /jobs/{id}/fail body {"lease_id","error": str,"retryable": bool} -> 200 | 409

Leases expire (configurable); an expired lease puts the job back to pending (attempt counted).
Max attempts / backoff are Zoomer config. Zoomer writes results next to the recording by default
(configurable path template), e.g. <recording dir>/<basename>.<model>.txt|srt|vtt|json.
