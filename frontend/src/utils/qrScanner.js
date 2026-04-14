import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQrbox() {
  const vw = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight || 844 : 844;
  const side = Math.floor(Math.min(vw, vh) * 0.8);
  return Math.max(220, Math.min(340, side));
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

async function waitForScannerHost(elementId, timeoutMs = 3000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const el = document.getElementById(elementId);
    if (el && isElementVisible(el)) {
      return el;
    }
    await sleep(50);
  }

  throw new Error("Scanner box is not ready.");
}

export async function startQrScanner({ elementId, onScan, fps = 10 }) {
  if (!elementId) throw new Error("Missing scanner elementId.");
  if (typeof onScan !== "function") throw new Error("Missing scanner callback.");

  const host = await waitForScannerHost(elementId);
  host.innerHTML = "";

  // Give React + Safari one more paint cycle before scanner widget mounts.
  await sleep(120);

  const scanner = new Html5QrcodeScanner(
    elementId,
    {
      fps,
      qrbox: getQrbox(),
      rememberLastUsedCamera: true,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: false,
      },
    },
    false
  );

  let stopped = false;
  let lastValue = "";
  let lastTs = 0;

  scanner.render(
    async (decodedText) => {
      if (stopped) return;

      const value = String(decodedText || "").trim();
      if (!value) return;

      const now = Date.now();
      if (value === lastValue && now - lastTs < 1200) return;
      lastValue = value;
      lastTs = now;

      await onScan(value);
    },
    () => {
      // Ignore frame-level decode errors.
    }
  );

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;

      try {
        await scanner.clear();
      } catch {
        // ignore
      }

      try {
        const el = document.getElementById(elementId);
        if (el) el.innerHTML = "";
      } catch {
        // ignore
      }
    },
  };
}
