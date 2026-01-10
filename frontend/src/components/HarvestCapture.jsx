// src/components/HarvestCapture.jsx
import { useEffect, useRef, useState } from "react";
import { addPhoto, getPhotos, clearPhotos } from "../store/harvestStore";

export default function HarvestCapture({ itemId }) {
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
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCamera = () => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
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
      // Ensure we stop any old stream first
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

      // Turn UI on FIRST so the <video> is guaranteed to be mounted
      setCameraOn(true);

      // Wait one tick for React to render the video element
      await new Promise((r) => setTimeout(r, 0));

      const v = videoRef.current;
      if (!v) throw new Error("Video element not ready.");

      v.srcObject = stream;
      v.setAttribute("playsinline", "true");
      v.muted = true;
      v.autoplay = true;

      // Wait metadata so videoWidth/videoHeight become available
      await new Promise((resolve) => {
        const handler = () => {
          v.removeEventListener("loadedmetadata", handler);
          resolve();
        };
        v.addEventListener("loadedmetadata", handler);
      });

      // Some Android devices need a direct play() after metadata
      await v.play();

      setIsStarting(false);
    } catch (e) {
      setIsStarting(false);
      setCamError(e?.message || "Cannot start camera.");
      stopCamera();
    }
  };

  const capture = async () => {
    setCamError("");

    const v = videoRef.current;
    if (!v) return;

    // If camera is still warming up, avoid black frame
    if (!v.videoWidth || !v.videoHeight) {
      setCamError("Camera not ready yet. Wait 1 second and try again.");
      return;
    }

    // Wait one frame so we capture a painted frame
    await new Promise((r) => requestAnimationFrame(r));

    const w = v.videoWidth;
    const h = v.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCamError("Cannot capture image (canvas error).");
      return;
    }

    ctx.drawImage(v, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    addPhoto(itemId, dataUrl);
    setPhotos(getPhotos(itemId));
  };

  if (!itemId) return <div>Please scan an item first.</div>;

  return (
    <div>
      {camError && <div className="alert alert-error">{camError}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!cameraOn ? (
          <button className="primary" onClick={startCamera} disabled={isStarting}>
            {isStarting ? "Starting..." : "Take Picture"}
          </button>
        ) : (
          <>
            <button className="primary" onClick={capture}>
              Capture
            </button>
            <button onClick={stopCamera}>Done</button>
          </>
        )}

        <button
          onClick={() => {
            clearPhotos(itemId);
            setPhotos([]);
          }}
        >
          Clear Photos for This Item
        </button>

        <div>
          <strong>Photos:</strong> {photos.length}
        </div>
      </div>

      {/* Always mounted video (critical fix). Just hide when camera off */}
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
