const backgroundVideo = document.querySelector(".site-bg-video");
const personResults = document.querySelector("#personResults");
const searchInput = document.querySelector("#facultySearch");
const clearButton = document.querySelector("#clearSearch");
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

function personRosterIsVisible() {
  return Boolean(personResults && !personResults.classList.contains("hidden"));
}

function playVideoQuietly() {
  if (!backgroundVideo || prefersReducedMotion?.matches || document.hidden) return;
  const playResult = backgroundVideo.play();
  if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
}

function updateRosterBackgroundMode() {
  const focused = personRosterIsVisible();
  document.body.classList.toggle("roster-focus-mode", focused);

  if (!backgroundVideo) return;
  if (focused) {
    backgroundVideo.pause();
  } else {
    playVideoQuietly();
  }
}

if (personResults) {
  new MutationObserver(updateRosterBackgroundMode).observe(personResults, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

["click", "input", "keyup", "change"].forEach((eventName) => {
  document.addEventListener(eventName, () => window.setTimeout(updateRosterBackgroundMode, 80), true);
});

clearButton?.addEventListener("click", () => window.setTimeout(updateRosterBackgroundMode, 120));
searchInput?.addEventListener("search", () => window.setTimeout(updateRosterBackgroundMode, 120));
document.addEventListener("visibilitychange", updateRosterBackgroundMode);
prefersReducedMotion?.addEventListener?.("change", updateRosterBackgroundMode);

updateRosterBackgroundMode();
