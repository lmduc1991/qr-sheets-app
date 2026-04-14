import { Html5Qrcode, Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFastQrbox() {
  const vw = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight || 844 : 844;
  const side = Math.floor(Math.min(vw, vh) * 0.62);
  const clamped = Math.max(220, Math.min(280, side));
  return { width: clamped, height: clamped };
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
    if (el && isElementVisible(el)) return el;
    await sleep(40);
  }

  throw new Error("Scanner box is not ready.");
}

function isIOSLike() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = navigator.maxTouchPoints || 0;

  return /iPhone|iPad|iPod/i.test(ua)
    || (/Mac/i.test(platform) && touchPoints > 1)
    || (/Macintosh/i.test(ua) && touchPoints > 1);
}

function pickBackCamera(cameras = []) {
  if (!Array.isArray(cameras) || cameras.length === 0) return null;

  const score = (label) => {
    const x = String(label || "").toLowerCase();
    if (x.includes("back") || x.includes("rear") || x.includes("environment")) return 50;
    if (x.includes("wide") || x.includes("ultra")) return 40;
    if (x.includes("camera 0")) return 20;
    return 0;
  };

  return [...cameras].sort((a, b) => score(b?.label) - score(a?.label))[0] || cameras[0] || null;
}

export async function startQrScanner({ elementId, onScan, fps = 18 }) {
  if (!elementId) throw new Error("Missing scanner elementId.");
  if (typeof onScan !== "function") throw new Error("Missing scanner callback.");

  const host = await waitForScannerHost(elementId);
  host.innerHTML = "";

  const qrbox = getFastQrbox();
  const isiOS = isIOSLike();

  let stopped = false;
  let lastValue = "";
  let lastTs = 0;

  const handleScan = async (decodedText) => {
    if (stopped) return;

    const value = String(decodedText || "").trim();
    if (!value) return;

    const now = Date.now();
    if (value === lastValue && now - lastTs < 900) return;
    lastValue = value;
    lastTs = now;

    await onScan(value);
  };

  if (isiOS) {
    await sleep(80);

    const scanner = new Html5QrcodeScanner(
      elementId,
      {
        fps: Math.max(15, fps),
        qrbox,
        rememberLastUsedCamera: true,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: false,
        },
      },
      false
    );

    scanner.render(
      async (decodedText) => {
        await handleScan(decodedText);
      },
      () => {
        // ignore frame-level decode errors
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

  const qr = new Html5Qrcode(elementId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    verbose: false,
  });

  const config = {
    fps: Math.max(18, fps),
    qrbox,
    rememberLastUsedCamera: true,
    disableFlip: true,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true,
    },
  };

  const onError = () => {
    // ignore frame-level decode errors
  };

  let started = false;
  let lastErr = null;

  const cameraAttempts = [
    { facingMode: { exact: "environment" } },
    { facingMode: "environment" },
    { facingMode: { ideal: "environment" } },
  ];

  for (const cameraConfig of cameraAttempts) {
    try {
      await qr.start(cameraConfig, config, handleScan, onError);
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
        await qr.start(picked.id, config, handleScan, onError);
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
