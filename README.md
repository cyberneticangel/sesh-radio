# ☠ SESH RADIO

A self-hosted web radio station: Icecast for streaming, Liquidsoap as the autoDJ, and a dark, skull-themed player page.

```
music/*.mp3 ─▶ Liquidsoap (autoDJ, shuffle + crossfade) ─▶ Icecast :8000/sesh ─▶ nginx :8080 ─▶ browser
                   ▲
   live DJ ───────┘ harbor :8005/live (takes over when connected)
```

## Run it

Requires Docker (Docker Desktop or OrbStack on macOS).

```sh
cp .env.example .env          # set real passwords
cp ~/some/tunes/*.mp3 music/  # mp3, ogg, flac, etc.
docker compose up -d --build
```

- Player: http://localhost:8080
- Raw stream: http://localhost:8000/sesh
- Icecast admin: http://localhost:8000/admin (user `admin`, `ICECAST_ADMIN_PASSWORD`)

Files dropped into `music/` are picked up automatically. With no music, the station broadcasts silence instead of going offline.

## Going live

Point any Icecast-compatible broadcaster (BUTT, Mixxx, OBS + plugin) at:

| setting  | value                 |
|----------|-----------------------|
| host     | your server           |
| port     | `8005`                |
| mount    | `/live`               |
| user     | `source`              |
| password | `LIVE_PASSWORD`       |

The live feed takes over right away. When you disconnect, the autoDJ picks back up.

## Layout

| path                          | what it is                                           |
|-------------------------------|------------------------------------------------------|
| `docker-compose.yml`          | the three services                                   |
| `icecast/`                    | Alpine Icecast image; the config is filled in from env vars at startup |
| `liquidsoap/radio.liq`        | playlist, crossfade, live fallback, encoder settings |
| `nginx/default.conf`          | serves `web/` and proxies `/stream` and `/status-json.xsl` |
| `web/`                        | the player (plain HTML/CSS/JS, no build step)        |

The stream goes through nginx so the page and the audio share an origin, which lets the Web Audio visualizer read the samples.

## Production notes

- Change every password in `.env`.
- Put TLS in front of port 8080 (Caddy, Cloudflare, etc.), and leave 8000 and 8005 closed to the public unless you need them.
- If you put this behind HTTPS, set `ICECAST_HOSTNAME` to your domain.
