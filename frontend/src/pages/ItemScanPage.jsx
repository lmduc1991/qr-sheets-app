// src/pages/ItemScanPage.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, onSettingsChange } from "../store/settingsStore";
import { getItemByKey, updateItemByKey } from "../api/sheetsApi";

function PrettyDetails({ item, preferredOrder = [] }) {
  if (!item) return null;

  const entries = Object.entries(item || {})
    .filter(([k, v]) => k && v !== null && String(v).trim() !== "")
    .sort(([a], [b]) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {entries.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 220px) 1fr",
            gap: 10,
            padding: "8px 10px",
            border: "1px solid #eee",
            borderRadius: 10,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 800, color: "#222" }}>{k}</div>
          <div style={{ wordBreak: "break-word" }}>{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

export default function ItemScanPage() {
  // Reactive settings
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const keyColumn = settings?.keyColumn || "";
  const itemsSheetName = settings?.itemsSheetName || "";

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [scannedKey, setScannedKey] = useState("");
  const [headers, setHeaders] = useState([]);
  const [item, setItem] = useState(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const [isScanning, setIsScanning] = useState(false);

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const startScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    // Ensure scanner container exists (it is always mounted below now)
    setIsScanning(true);

    // Next tick: safe to render scanner into the container
    setTimeout(() => {
      const el = document.getElementById("item-scan-reader");
      if (!el) {
        setError("Scanner container not ready.");
        setIsScanning(false);
        return;
      }
      el.innerHTML = "";

      const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
      const scanner = new Html5QrcodeScanner(
        "item-scan-reader",
        { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
        false
      );

      scanner.render(
        async (decodedText) => {
          const key = String(decodedText || "").trim();
          if (!key) return;
          await stopScanner();
          await loadItem(key);
        },
        () => {}
      );

      scannerRef.current = scanner;
    }, 0);
  };

  const loadItem = async (key) => {
    setStatus("Loading item...");
    setError("");
    setEditing(false);
    setItem(null);
    setForm({});
    setScannedKey(key);

    try {
      const r = await getItemByKey(key);
      setHeaders(r.headers || []);
      if (!r.found) {
        setStatus("");
        setError(`Item not found in ${itemsSheetName || "Items sheet"}.`);
        return;
      }
      setItem(r.item);
      setForm(r.item);
      setStatus("Item loaded.");
    } catch (e) {
      setStatus("");
      setError(e.message || "Failed to load item.");
    }
  };

  const save = async () => {
    setError("");
    setStatus("Saving...");
    try {
      // patch excludes Key column
      const patch = {};
      (headers || []).forEach((h) => {
        if (!h) return;
        if (h === keyColumn) return;
        patch[h] = form[h] ?? "";
      });

      const r = await updateItemByKey(scannedKey, patch);
      setStatus(`Saved. Updated fields: ${r.updated ?? 0}`);
      setEditing(false);
      setItem((prev) => ({ ...(prev || {}), ...patch }));
    } catch (e) {
      setStatus("");
      setError(e.message || "Save failed.");
    }
  };

  const scanAnother = async () => {
    setItem(null);
    setScannedKey("");
    setHeaders([]);
    setForm({});
    setEditing(false);
    setStatus("");
    setError("");

    // Return to WAIT state (do not auto-start)
    await stopScanner();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings?.proxyUrl) return <div>Please go to Setup first.</div>;

  return (
    <div className="card">
      <h3>Scan</h3>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!item && (
        <>
          <p>
            Scan QR from your Key Column: <strong>{keyColumn}</strong>
            {itemsSheetName ? (
              <>
                {" "}
                (Items tab: <strong>{itemsSheetName}</strong>)
              </>
            ) : null}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {!isScanning ? (
              <button className="primary" onClick={startScanner}>
                Start Scanning
              </button>
            ) : (
              <button style={{ marginTop: 10 }} onClick={stopScanner}>
                Stop
              </button>
            )}
          </div>

          {/* IMPORTANT: always mounted so Html5QrcodeScanner can render reliably */}
          <div style={{ marginTop: 10, display: isScanning ? "block" : "none" }}>
            <div id="item-scan-reader" />
          </div>
        </>
      )}

      {item && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div>
              <strong>Key:</strong> {scannedKey}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="primary" onClick={() => setEditing((v) => !v)}>
                {editing ? "Cancel Edit" : "Edit"}
              </button>
              <button onClick={scanAnother}>Scan Another</button>
            </div>
          </div>

          {editing ? (
            <>
              <p>Edit all columns except Key ID ({keyColumn}).</p>
              <div className="grid">
                {headers
                  .filter((h) => h && h !== keyColumn)
                  .map((h) => (
                    <label key={h} className="field">
                      {h}
                      <input
                        value={form[h] ?? ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [h]: e.target.value }))}
                      />
                    </label>
                  ))}
              </div>
              <button className="primary" onClick={save}>
                Save
              </button>
            </>
          ) : (
            <div style={{ marginTop: 10 }}>
              <h4 style={{ margin: "0 0 10px 0" }}>Item details</h4>
              <PrettyDetails item={item} preferredOrder={headers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
