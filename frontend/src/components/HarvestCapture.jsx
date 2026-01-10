// src/components/HarvestCapture.jsx
import { useEffect, useRef, useState } from "react";
import { addPhoto, getPhotos, clearPhotos } from "../store/harvestStore";
import { useT } from "../i18n";

export default function HarvestCapture({ itemId }) {
  const { t } = useT();

  const [photos, setPhotos] = useState([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!itemId) return;
    setPhotos(getPhotos(itemId));
  }, [itemId]);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCamera = () => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t0) => t0.stop());
    streamRef.current = null;

    const v = videoRef.current;
    if (v) v.srcObject = null;

    setCameraOn(false);
    setIsStarting(false);
  };

  const startCamera = async () => {
    setCamError("");
    setIsStarting(true);

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraOn(true);

      await new Promise((r) => setTimeout(r, 0));

      const v = videoRef.current;
      if (!v) throw new Error(t("harvest_capture_video_not_ready"));

      v.srcObject = stream;
      v.setAttribute("playsinline", "true");
      v.muted = true;
      v.autoplay = true;

      await new Promise((resolve) => {
        const handler = () => {
          v.removeEventListener("loadedmetadata", handler);
          resolve();
        };
        v.addEventListener("loadedmetadata", handler);
      });

      await v.play();
      setIsStarting(false);
    } catch (e) {
      setIsStarting(false);
      setCamError(e?.message || t("harvest_capture_cannot_start_camera"));
      stopCamera();
    }
  };

  const capture = async () => {
    setCamError("");

    const v = videoRef.current;
    if (!v) return;

    if (!v.videoWidth || !v.videoHeight) {
      setCamError(t("harvest_capture_camera_not_ready"));
      return;
    }

    await new Promise((r) => requestAnimationFrame(r));

    const w = v.videoWidth;
    const h = v.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCamError(t("harvest_capture_canvas_error"));
      return;
    }

    ctx.drawImage(v, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    addPhoto(itemId, dataUrl);
    setPhotos(getPhotos(itemId));
  };

  if (!itemId) return <div>{t("harvest_capture_scan_item_first")}</div>;

  return (
    <div>
      {camError && <div className="alert alert-error">{camError}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!cameraOn ? (
          <button className="primary" onClick={startCamera} disabled={isStarting}>
            {isStarting ? t("harvest_capture_starting") : t("harvest_capture_take_picture")}
          </button>
        ) : (
          <>
            <button className="primary" onClick={capture}>
              {t("harvest_capture_capture")}
            </button>
            <button onClick={stopCamera}>{t("done")}</button>
          </>
        )}

        <button
          onClick={() => {
            clearPhotos(itemId);
            setPhotos([]);
          }}
        >
          {t("harvest_capture_clear_photos")}
        </button>

        <div>
          <strong>{t("harvest_capture_photos_count")}</strong> {photos.length}
        </div>
      </div>

      <div style={{ marginTop: 10, display: cameraOn ? "block" : "none" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            maxWidth: 520,
            borderRadius: 12,
            border: "1px solid #e6e6e6",
            background: "#000",
          }}
        />
      </div>

      {photos.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
            marginTop: 10,
          }}
        >
          {photos.map((p, idx) => (
            <img key={idx} src={p.dataUrl} alt={`harvest-${idx}`} style={{ width: "100%", borderRadius: 8 }} />
          ))}
        </div>
      )}
    </div>
  );
}
