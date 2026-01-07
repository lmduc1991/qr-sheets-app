// src/pages/ItemBulkScanPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings } from "../store/settingsStore";
import { getHeaders, bulkUpdate } from "../api/sheetsApi";
import { useT } from "../i18n";

export default function ItemBulkScanPage() {
  const { t } = useT();

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
        setKeys((prev) => Array.from(new Set([...prev.map(String), String(key)])));
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const loadCols = async () => {
    setError("");
    setStatus(t("status_loading_columns"));
    try {
      const h = await getHeaders(settings.itemsSpreadsheetId, settings.itemsSheetName);
      setHeaders(h);
      setStatus(t("status_columns_loaded"));
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_load_columns"));
    }
  };

  const doBulkUpdate = async () => {
    setError("");
    if (keys.length === 0) return setError(t("err_no_scanned_keys"));

    const patch = {};
    Object.keys(form).forEach((k) => {
      const v = String(form[k] ?? "").trim();
      if (!v) return;
      if (k === keyColumn) return;
      patch[k] = v;
    });

    if (Object.keys(patch).length === 0) return setError(t("err_no_fields_entered"));

    setIsSaving(true);
    try {
      const r = await bulkUpdate(keys, patch);
      setStatus(`${t("status_bulk_updated")} ${r.updated || 0}. ${t("status_not_found")} ${(r.notFound || []).length}`);
      setEditing(false);
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_bulk_update_failed"));
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

  if (!settings?.proxyUrl) return <div>{t("please_go_setup_first")}</div>;

  return (
    <div className="card">
      <h3>{t("bulk_scan")}</h3>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <p>
        {t("help_scan_many_keys")} <strong>{keys.length}</strong>
      </p>

      <div id="bulk-scan-reader" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button className="primary" onClick={() => setEditing((v) => !v)} disabled={isSaving}>
          {editing ? t("cancel_edit") : t("edit")}
        </button>

        <button
          onClick={() => {
            setKeys([]);
            setForm({});
            setStatus(t("msg_cleared_scanned_keys"));
          }}
          disabled={isSaving}
        >
          {t("clear_scans")}
        </button>

        {keys.length > 0 && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(keys.join("\n"));
                setStatus(t("msg_copied_clipboard"));
              } catch {
                setError(t("err_copy_failed"));
              }
            }}
            disabled={isSaving}
          >
            {t("copy_all")}
          </button>
        )}
      </div>

      {keys.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{t("scanned_items")}</div>
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
                  {t("remove")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <>
          <p style={{ marginTop: 12 }}>{t("help_fill_only_fields")}</p>

          <div className="grid">
            {headers
              .filter((h) => h && h !== keyColumn)
              .map((h) => (
                <label className="field" key={h}>
                  {h}
                  <input
                    value={form[h] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [h]: e.target.value }))}
                    placeholder={t("placeholder_keep_existing")}
                    disabled={isSaving}
                  />
                </label>
              ))}
          </div>

          <button className="primary" onClick={doBulkUpdate} disabled={isSaving}>
            {isSaving ? t("saving") : t("save_bulk_update")}
          </button>
        </>
      )}
    </div>
  );
}
