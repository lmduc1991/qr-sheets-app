// src/pages/ItemBulkScanPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings } from "../store/settingsStore";
import { getHeaders, bulkUpdate } from "../api/sheetsApi";

export default function ItemBulkScanPage() {
  const settings = useMemo(() => loadSettings(), []);
  const keyColumn = settings?.keyColumn || "";

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [headers, setHeaders] = useState([]);
  const [keys, setKeys] = useState([]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  };

  const startScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    const el = document.getElementById("bulk-scan-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      "bulk-scan-reader",
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const key = String(decodedText || "").trim();
        if (!key) return;

        // IMPORTANT: fix invalid ".prev" syntax
        setKeys((prev) => Array.from(new Set([...prev.map(String), String(key)])));
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const loadCols = async () => {
    setError("");
    setStatus("Loading columns...");
    try {
      const h = await getHeaders(settings.itemsSpreadsheetId, settings.itemsSheetName);
      setHeaders(h);
      setStatus("Columns loaded.");
    } catch (e) {
      setStatus("");
      setError(e.message || "Failed to load columns.");
    }
  };

  const doBulkUpdate = async () => {
    setError("");
    if (keys.length === 0) return setError("No scanned keys yet.");

    const patch = {};
    Object.keys(form).forEach((k) => {
      const v = String(form[k] ?? "").trim();
      if (!v) return;
      if (k === keyColumn) return;
      patch[k] = v;
    });

    if (Object.keys(patch).length === 0) return setError("No fields entered. Fill at least 1 field to update.");

    setIsSaving(true);
    try {
      const r = await bulkUpdate(keys, patch);
      setStatus(`Bulk updated: ${r.updated || 0}. Not found: ${(r.notFound || []).length}`);
      setEditing(false);
    } catch (e) {
      setStatus("");
      setError(e.message || "Bulk update failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeKey = (k) => setKeys((prev) => prev.filter((x) => String(x) !== String(k)));

  useEffect(() => {
    loadCols();
    startScanner();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings?.proxyUrl) return <div>Please go to Setup first.</div>;

  return (
    <div className="card">
      <h3>Bulk Scan</h3>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <p>
        Scan many QR codes. Keys scanned: <strong>{keys.length}</strong>
      </p>

      <div id="bulk-scan-reader" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button className="primary" onClick={() => setEditing((v) => !v)} disabled={isSaving}>
          {editing ? "Cancel Edit" : "Edit"}
        </button>
        <button
          onClick={() => {
            setKeys([]);
            setForm({});
            setStatus("Cleared scanned keys.");
          }}
          disabled={isSaving}
        >
          Clear Scans
        </button>

        {keys.length > 0 && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(keys.join("\n"));
                setStatus("Copied scanned keys to clipboard.");
              } catch {
                setError("Copy failed (clipboard not available).");
              }
            }}
            disabled={isSaving}
          >
            Copy All
          </button>
        )}
      </div>

      {/* Always-visible scanned list */}
      {keys.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Scanned Items</div>
          <div
            style={{
              maxHeight: 220,
              overflow: "auto",
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 10,
              background: "#fafafa",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {keys.map((k) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                <span style={{ fontWeight: 700 }}>{k}</span>
                <button onClick={() => removeKey(k)} style={{ padding: "2px 8px" }} disabled={isSaving}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <>
          <p style={{ marginTop: 12 }}>Fill only fields you want to update. Blank fields keep existing values.</p>

          <div className="grid">
            {headers
              .filter((h) => h && h !== keyColumn)
              .map((h) => (
                <label className="field" key={h}>
                  {h}
                  <input
                    value={form[h] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [h]: e.target.value }))}
                    placeholder="leave blank to keep existing"
                    disabled={isSaving}
                  />
                </label>
              ))}
          </div>

          <button className="primary" onClick={doBulkUpdate} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Bulk Update"}
          </button>
        </>
      )}
    </div>
  );
}
