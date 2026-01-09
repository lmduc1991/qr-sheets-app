// src/pages/ItemScanPage.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, onSettingsChange } from "../store/settingsStore";
import { getItemByKey, updateItemByKey } from "../api/sheetsApi";
import { useT } from "../i18n";

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
  const { t } = useT();

  // Settings can change after Setup (new sheet/tab/key column). Subscribe so Scan page updates immediately.
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

    const el = document.getElementById("item-scan-reader");
    if (el) el.innerHTML = ""; // important: reset scanner DOM

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
    setIsScanning(true);
  };

  const loadItem = async (key) => {
    setStatus(t("status_loading_item"));
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
        setError(`${t("err_item_not_found_in")} ${itemsSheetName || "Items sheet"}.`);
        return;
      }
      setItem(r.item);
      setForm(r.item);
      setStatus(t("status_item_loaded"));
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_load_item"));
    }
  };

  const save = async () => {
    setError("");
    setStatus(t("status_saving"));
    try {
      // patch excludes Key column
      const patch = {};
      (headers || []).forEach((h) => {
        if (!h) return;
        if (h === keyColumn) return;
        patch[h] = form[h] ?? "";
      });

      const r = await updateItemByKey(scannedKey, patch);
      setStatus(`${t("status_saved_updated_fields")} ${r.updated ?? 0}`);
      setEditing(false);
      setItem((prev) => ({ ...(prev || {}), ...patch }));
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_save_failed"));
    }
  };

  const resetToReady = async () => {
    setItem(null);
    setScannedKey("");
    setHeaders([]);
    setForm({});
    setEditing(false);
    setStatus("");
    setError("");
    await stopScanner();
  };

  const scanAnother = async () => {
    // Expectation: return to ready state (do NOT auto-open camera)
    await resetToReady();
  };

  useEffect(() => {
    // IMPORTANT change:
    // Do NOT auto-start scanning on mount.
    // This prevents landing on a “blank” scan page after Setup.
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings?.proxyUrl) return <div>{t("please_go_setup_first")}</div>;

  return (
    <div className="card">
      <h3>{t("scan")}</h3>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!item && (
        <>
          <p>
            {t("label_scan_key_column")}: <strong>{keyColumn}</strong>
            {itemsSheetName ? (
              <>
                {" "}
                ({t("label_items_tab")}: <strong>{itemsSheetName}</strong>)
              </>
            ) : null}
          </p>

          {!isScanning ? (
            <button className="primary" onClick={startScanner}>
              {t("start_scan") || "Start Scan"}
            </button>
          ) : (
            <button onClick={stopScanner}>{t("stop_scan") || "Stop Scan"}</button>
          )}

          <div style={{ marginTop: 10 }} id="item-scan-reader" />
        </>
      )}

      {item && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div>
              <strong>{t("label_key")}:</strong> {scannedKey}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="primary" onClick={() => setEditing((v) => !v)}>
                {editing ? t("cancel_edit") : t("edit")}
              </button>
              <button onClick={scanAnother}>{t("scan_another")}</button>
            </div>
          </div>

          {editing ? (
            <>
              <p>
                {t("help_edit_except_key")} ({keyColumn}).
              </p>
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
                {t("save")}
              </button>
            </>
          ) : (
            <div style={{ marginTop: 10 }}>
              <h4 style={{ margin: "0 0 10px 0" }}>{t("label_item_details")}</h4>
              <PrettyDetails item={item} preferredOrder={headers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
