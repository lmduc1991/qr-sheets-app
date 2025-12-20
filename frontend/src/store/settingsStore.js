const KEY = "qr_sheets_settings_v1";
const EVT = "qr_settings_changed";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Merge partial settings instead of overwriting everything
export function saveSettings(partial) {
  const current = loadSettings() || {};
  const next = { ...current, ...(partial || {}) };
  localStorage.setItem(KEY, JSON.stringify(next));

  // Notify the app to re-read settings (works in Capacitor too)
  window.dispatchEvent(new Event(EVT));
  return next;
}

export function clearSettings() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

export function onSettingsChange(handler) {
  const fn = () => handler(loadSettings());
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", fn); // useful on web
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", fn);
  };
}
