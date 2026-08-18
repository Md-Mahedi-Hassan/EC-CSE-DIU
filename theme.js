const STORAGE_KEY = "invigilation-duty-theme";
const root = document.documentElement;
const toggles = [...document.querySelectorAll(".theme-toggle")];

function preferredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#121814" : "#f4f6f1",
  );

  toggles.forEach((toggle) => {
    const dark = theme === "dark";
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    toggle.querySelector(".theme-label").textContent = dark ? "Dark" : "Light";
  });
}

applyTheme(preferredTheme());

toggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  });
});
