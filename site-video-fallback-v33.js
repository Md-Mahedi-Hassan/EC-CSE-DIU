const backgroundVideo = document.querySelector(".site-bg-video");
const source = backgroundVideo?.querySelector("source");
let videoReady = false;
let fallbackActivated = false;

function activateFallback() {
  if (fallbackActivated) return;
  fallbackActivated = true;
  document.body.classList.add("video-fallback-mode");
  try { backgroundVideo?.pause(); } catch {}
}

function markReady() {
  videoReady = true;
  if (!fallbackActivated) document.body.classList.remove("video-fallback-mode");
}

if (!backgroundVideo || !source || !source.getAttribute("src")) {
  activateFallback();
} else {
  backgroundVideo.addEventListener("loadeddata", markReady, { once: true });
  backgroundVideo.addEventListener("canplay", markReady, { once: true });
  backgroundVideo.addEventListener("playing", markReady, { once: true });
  backgroundVideo.addEventListener("error", activateFallback);
  source.addEventListener("error", activateFallback);
  backgroundVideo.addEventListener("stalled", () => { if (!videoReady) activateFallback(); });
  backgroundVideo.addEventListener("abort", () => { if (!videoReady) activateFallback(); });
  backgroundVideo.addEventListener("emptied", () => { if (!videoReady) activateFallback(); });
  window.setTimeout(() => {
    if (!videoReady && (backgroundVideo.readyState || 0) < 2) activateFallback();
  }, 2500);
}
