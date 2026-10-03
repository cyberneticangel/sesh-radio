# SESH RADIO — autoDJ + live input → Icecast

settings.log.stdout := true
settings.log.file := false

icecast_host = environment.get(default="icecast", "ICECAST_HOST")
source_password = environment.get(default="hackme", "ICECAST_SOURCE_PASSWORD")
live_password = environment.get(default="hackme", "LIVE_PASSWORD")

# AutoDJ: shuffle everything in /music, pick up new files automatically.
music = playlist(mode="randomize", reload_mode="watch", "/music")
music = crossfade(duration=4., music)

# Live DJ: stream to icecast://source:LIVE_PASSWORD@host:8005/live
# (e.g. from BUTT or Mixxx). Takes over immediately, autoDJ resumes when you disconnect.
live = input.harbor("live", port=8005, password=live_password)

radio = fallback(track_sensitive=false, [live, music])

# Silence instead of dead air when /music is empty.
radio = mksafe(radio)

output.icecast(
  %mp3(bitrate=192, samplerate=44100, stereo=true),
  host=icecast_host,
  port=8000,
  password=source_password,
  mount="sesh",
  name="SESH RADIO",
  description="Music from beyond the grave",
  genre="dark",
  radio
)
