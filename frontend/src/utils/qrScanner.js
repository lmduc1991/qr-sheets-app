import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isElementReady(el) {
  if (!el || !el.isConnected) return false;

  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function waitForScannerContainer(elementId, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const el = document.getElementById(elementId);
    if (isElementReady(el)) {
      // Give React/layout one extra beat so Safari gets a painted box.
      await sleep(30);
      return el;
    }
    await sleep(40);
  }

  throw new Error("Scanner container not ready.");
}

function getPreferredQrbox() {
  const vw = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight || 844 : 844;
  const side = Math.floor(Math.min(vw, vh) * 0.7);
  const clamped = Math.max(180, Math.min(300, side));
  return { width: clamped, height: clamped };
}

function pickBackCamera(cameras = []) {
  if (!Array.isArray(cameras) || cameras.length === 0) return null;

  const ranked = [...cameras].sort((a, b) => {
    const la = String(a?.label || "").toLowerCase();
    const lb = String(b?.label || "").toLowerCase();

    const score = (label) => {
      if (label.includes("back")) return 7;
      if (label.includes("rear")) return 6;
      if (label.includes("environment")) return 5;
      if (label.includes("wide")) return 4;
      if (label.includes("camera 0")) return 3;
      return 0;
    };

    return score(lb) - score(la);
  });

  return ranked[0] || cameras[0] || null;
}

async function tryStart(html5QrCode, cameraConfig, config, onSuccess, onError) {
  await html5QrCode.start(cameraConfig, config, onSuccess, onError);
  return true;
}

export async function startQrScanner({ elementId, onScan, fps = 10 }) {
  const el = await waitForScannerContainer(elementId, 3000);

  el.innerHTML = "";
  el.style.minHeight = "280px";
  el.style.width = "100%";

  const qr = new Html5Qrcode(elementId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    verbose: false,
  });

  let stopped = false;
  let lastValue = "";
  let lastTs = 0;

  const config = {
    fps,
    qrbox: getPreferredQrbox(),
    rememberLastUsedCamera: true,
    disableFlip: false,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false,
    },
  };

  const onSuccess = async (decodedText) => {
    const value = String(decodedText || "").trim();
    if (!value) return;

    const now = Date.now();
    if (value === lastValue && now - lastTs < 1200) return;
    lastValue = value;
    lastTs = now;

    await onScan(value);
  };

  const onError = () => {};

  const cameraAttempts = [
    { facingMode: { exact: "environment" } },
    { facingMode: "environment" },
    { facingMode: { ideal: "environment" } },
  ];

  let started = false;
  let lastErr = null;

  for (const cameraConfig of cameraAttempts) {
    try {
      await tryStart(qr, cameraConfig, config, onSuccess, onError);
      started = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!started) {
    try {
      const cameras = await Html5Qrcode.getCameras();
      const picked = pickBackCamera(cameras);
      if (picked?.id) {
        await tryStart(qr, picked.id, config, onSuccess, onError);
        started = true;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!started) {
    try {
      const cameras = await Html5Qrcode.getCameras();
      const fallback = cameras?.[0];
      if (fallback?.id) {
        await tryStart(qr, fallback.id, config, onSuccess, onError);
        started = true;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!started) {
    try {
      await qr.clear();
    } catch {
      // ignore
    }
    throw new Error(lastErr?.message || "Failed to start scanner.");
  }

  // Give iPhone Safari a moment after camera startup before first decode loop.
  await sleep(120);

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;

      try {
        await qr.stop();
      } catch {
        // ignore
      }

      try {
        await qr.clear();
      } catch {
        // ignore
      }
    },
  };
}
