(() => {
  const STREAM_URL = "/stream";
  const STATUS_URL = "/status-json.xsl";
  const MOUNT = "/sesh";
  const POLL_MS = 10000;

  const body = document.body;
  const audio = document.getElementById("audio");
  const playBtn = document.getElementById("play");
  const muteBtn = document.getElementById("mute");
  const volume = document.getElementById("volume");
  const nowPlaying = document.getElementById("nowPlaying");
  const marquee = nowPlaying.parentElement;
  const listenersEl = document.getElementById("listeners");
  const bitrateEl = document.getElementById("bitrate");
  const onAirText = document.getElementById("onAirText");

  let audioCtx, analyser, freq;
  let playing = false;

  // ---- playback ----

  function setState(state) {
    body.classList.toggle("is-loading", state === "loading");
    body.classList.toggle("is-playing", state === "playing");
    playBtn.setAttribute("aria-label", state === "playing" ? "Pause" : "Play");
  }

  function initAudioGraph() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      freq = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) {
      console.warn("Visualizer unavailable:", e);
    }
  }

  function play() {
    initAudioGraph();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    // Fresh URL each time so we join the live edge instead of a stale buffer.
    audio.src = `${STREAM_URL}?t=${Date.now()}`;
    setState("loading");
    playing = true;
    audio.play().catch((err) => {
      console.warn(err);
      stop();
    });
  }

  function stop() {
    playing = false;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setState("idle");
  }

  const toggle = () => (playing ? stop() : play());

  playBtn.addEventListener("click", toggle);
  audio.addEventListener("playing", () => setState("playing"));
  audio.addEventListener("waiting", () => playing && setState("loading"));
  audio.addEventListener("error", () => {
    if (!playing) return;
    setState("loading");
    setTimeout(() => playing && play(), 3000); // stream dropped — retry
  });

  // Hooks for the 3D scene (scene.js).
  window.seshRadio = {
    toggle,
    levels() {
      if (!playing || !analyser) return null;
      analyser.getByteFrequencyData(freq);
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += freq[i];
      return { bass: bass / (6 * 255), spectrum: freq };
    },
  };

  // ---- volume ----

  function applyVolume() {
    audio.volume = Number(volume.value);
    volume.style.setProperty("--fill", `${volume.value * 100}%`);
    body.classList.toggle("is-muted", audio.muted || audio.volume === 0);
    try { localStorage.setItem("sesh-volume", volume.value); } catch {}
  }

  try {
    const saved = localStorage.getItem("sesh-volume");
    if (saved !== null) volume.value = saved;
  } catch {}
  volume.addEventListener("input", () => { audio.muted = false; applyVolume(); });
  muteBtn.addEventListener("click", () => { audio.muted = !audio.muted; applyVolume(); });
  applyVolume();

  // ---- now playing ----

  function setTitle(text) {
    if (nowPlaying.textContent === text) return;
    nowPlaying.textContent = text;
    document.title = text && text !== "— silence —" ? `✠ ${text} · SESH RADIO` : "SESH RADIO";
    fitMarquee();
  }

  // Scroll the title only if it doesn't fit. Re-run once the pixel font loads,
  // since the fallback font is wider.
  function fitMarquee() {
    marquee.classList.remove("scrolling");
    requestAnimationFrame(() => {
      if (nowPlaying.scrollWidth > marquee.clientWidth) {
        marquee.style.setProperty("--dur", `${Math.max(8, nowPlaying.textContent.length * 0.35)}s`);
        marquee.classList.add("scrolling");
      }
    });
  }
  document.fonts?.ready.then(fitMarquee);
  addEventListener("resize", fitMarquee);

  async function pollStatus() {
    try {
      const res = await fetch(STATUS_URL, { cache: "no-store" });
      const data = await res.json();
      let sources = data?.icestats?.source;
      if (!sources) throw new Error("no source");
      if (!Array.isArray(sources)) sources = [sources];
      const src = sources.find((s) => (s.listenurl || "").endsWith(MOUNT)) || sources[0];

      const title = [src.artist, src.title].filter(Boolean).join(" — ") || src.server_name || "an unknown spirit";
      setTitle(title);
      listenersEl.textContent = src.listeners ?? 0;
      if (src.bitrate) bitrateEl.textContent = src.bitrate;
      body.classList.add("is-live");
      onAirText.textContent = "On Air";
    } catch {
      body.classList.remove("is-live");
      onAirText.textContent = "Silent";
      setTitle("— silence —");
      listenersEl.textContent = "0";
    }
  }

  pollStatus();
  setInterval(pollStatus, POLL_MS);
})();
