// src/pages/BinStoragePage.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import {
  getSheetTabs,
  appendBagStorage,
  appendBinStorage,
  getExistingChildrenForParent,
} from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

export default function BinStoragePage() {
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const proxyUrl = settings?.proxyUrl || "";

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [setupErr, setSetupErr] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);

  const [storageUrl, setStorageUrl] = useState(settings?.storageUrl || "");
  const storageSpreadsheetId = extractSpreadsheetId(storageUrl);

  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(false);

  const [bagStorageSheetName, setBagStorageSheetName] = useState(settings?.bagStorageSheetName || "");
  const [binStorageSheetName, setBinStorageSheetName] = useState(settings?.binStorageSheetName || "");

  useEffect(() => {
    setStorageUrl(settings?.storageUrl || "");
    setBagStorageSheetName(settings?.bagStorageSheetName || "");
    setBinStorageSheetName(settings?.binStorageSheetName || "");
  }, [settings?.storageUrl, settings?.bagStorageSheetName, settings?.binStorageSheetName]);

  const loadTabs = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!proxyUrl.trim()) return setSetupErr(t("proxy_missing_go_setup"));
    if (!storageSpreadsheetId)
      return setSetupErr(
        tt(
          "Storage sheet link invalid (cannot find spreadsheet ID).",
          "Enlace de Storage inválido (no se puede encontrar el ID).",
          "Link Storage không hợp lệ (không tìm thấy spreadsheet ID)."
        )
      );

    setTabsLoading(true);
    try {
      const tbs = await getSheetTabs(storageSpreadsheetId);
      setTabs(tbs);
      setSetupMsg(t("tabs_loaded_choose"));
    } catch (e) {
      setSetupErr(e.message || t("failed_load_columns"));
    } finally {
      setTabsLoading(false);
    }
  };

  const saveStorageSetup = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!proxyUrl.trim()) return setSetupErr(t("proxy_missing_go_setup"));
    if (!storageSpreadsheetId)
      return setSetupErr(
        tt(
          "Storage sheet link invalid (cannot find spreadsheet ID).",
          "Enlace de Storage inválido (no se puede encontrar el ID).",
          "Link Storage không hợp lệ (không tìm thấy spreadsheet ID)."
        )
      );
    if (!bagStorageSheetName.trim() || !binStorageSheetName.trim())
      return setSetupErr(t("storage_setup_missing"));

    setSetupSaving(true);
    try {
      saveSettings({
        storageUrl,
        storageSpreadsheetId,
        bagStorageSheetName: bagStorageSheetName.trim(),
        binStorageSheetName: binStorageSheetName.trim(),
      });
      setSetupMsg(t("storage_settings_saved"));
    } catch (e) {
      setSetupErr(
        e.message ||
          tt(
            "Failed to save Bin Storage settings.",
            "No se pudo guardar la configuración.",
            "Không thể lưu thiết lập."
          )
      );
    } finally {
      setSetupSaving(false);
    }
  };

  // --- Flow ---
  const [mode, setMode] = useState("bag"); // bag | bin
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [parent, setParent] = useState(""); // bag label or bin label
  const [childrenExisting, setChildrenExisting] = useState([]);
  const [childrenScanned, setChildrenScanned] = useState([]);

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    const el = document.getElementById("storage-reader");
    if (el) el.innerHTML = "";
  };

  const reset = async () => {
    await stopScanner();
    setStatus("");
    setError("");
    setParent("");
    setChildrenExisting([]);
    setChildrenScanned([]);
  };

  const startScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    const el = document.getElementById("storage-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      "storage-reader",
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const code = String(decodedText || "").trim();
        if (!code) return;

        // first scan sets parent; subsequent scans add children
        if (!parent) {
          setParent(code);
          setStatus(t("loading_existing_records"));
          setError("");

          try {
            const existing = await getExistingChildrenForParent({
              storageSpreadsheetId,
              sheetName: mode === "bag" ? bagStorageSheetName : binStorageSheetName,
              parent,
              parentValue: code,
            });
            setChildrenExisting(existing || []);
            setStatus("");
          } catch (e) {
            setStatus("");
            setError(e.message || t("err_failed_load_item"));
          }
          return;
        }

        // add child scan
        setChildrenScanned((prev) => Array.from(new Set([...prev, code])));
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const saveToSheet = async () => {
    setError("");
    setStatus("");

    if (!storageSpreadsheetId || !bagStorageSheetName || !binStorageSheetName) {
      setError(t("storage_setup_missing"));
      return;
    }
    if (!parent) {
      setError(mode === "bag" ? t("scan_bag_first") : t("scan_bin_first"));
      return;
    }
    if (childrenScanned.length === 0) {
      setError(tt("No scanned children.", "No hay hijos escaneados.", "Chưa quét dữ liệu con."));
      return;
    }

    setStatus(t("saving_to_sheet"));

    try {
      if (mode === "bag") {
        await appendBagStorage({
          storageSpreadsheetId,
          sheetName: bagStorageSheetName,
          bagLabel: parent,
          vineLabels: childrenScanned,
        });
      } else {
        await appendBinStorage({
          storageSpreadsheetId,
          sheetName: binStorageSheetName,
          binLabel: parent,
          bagLabels: childrenScanned,
        });
      }

      setStatus(t("storage_settings_saved"));
      await reset();
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_save_failed"));
    }
  };

  useEffect(() => {
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h2>{t("tab_storage")}</h2>

      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>
            {tt("Bin Storage Sheet Setup", "Configuración de Bin Storage", "Thiết lập Bin Storage")}
          </div>
          <button onClick={() => setSetupOpen((v) => !v)}>{setupOpen ? t("close") : t("storage_settings")}</button>
        </div>

        {setupOpen && (
          <div style={{ marginTop: 12 }}>
            {setupErr && <div className="alert alert-error">{setupErr}</div>}
            {setupMsg && <div className="alert alert-ok">{setupMsg}</div>}

            <label className="field">
              {t("storage_sheet_link")}
              <input
                value={storageUrl}
                onChange={(e) => setStorageUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={loadTabs} disabled={tabsLoading || !storageSpreadsheetId}>
                {tabsLoading ? t("loading") : t("load_tabs")}
              </button>
              <button onClick={saveStorageSetup} disabled={setupSaving || !storageSpreadsheetId}>
                {setupSaving ? t("saving") : t("save_storage_setup")}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label className="field">
                {tt("Bag scan → write to tab", "Escaneo Bag → escribir en pestaña", "Quét Bag → ghi vào tab")}
                {tabs.length ? (
                  <select value={bagStorageSheetName} onChange={(e) => setBagStorageSheetName(e.target.value)}>
                    <option value="">{t("not_set")}</option>
                    {tabs.map((tb) => (
                      <option key={tb} value={tb}>
                        {tb}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={bagStorageSheetName} onChange={(e) => setBagStorageSheetName(e.target.value)} />
                )}
              </label>

              <label className="field">
                {tt("Bin scan → write to tab", "Escaneo Bin → escribir en pestaña", "Quét Bin → ghi vào tab")}
                {tabs.length ? (
                  <select value={binStorageSheetName} onChange={(e) => setBinStorageSheetName(e.target.value)}>
                    <option value="">{t("not_set")}</option>
                    {tabs.map((tb) => (
                      <option key={tb} value={tb}>
                        {tb}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={binStorageSheetName} onChange={(e) => setBinStorageSheetName(e.target.value)} />
                )}
              </label>
            </div>
          </div>
        )}
      </div>

      {(status || error) && (
        <div className="card" style={{ marginTop: 10 }}>
          {status && <div className="alert">{status}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className={mode === "bag" ? "primary" : ""} onClick={() => reset().then(() => setMode("bag"))}>
            {tt("Bag → Vines", "Bag → Vides", "Bag → Cây")}
          </button>
          <button className={mode === "bin" ? "primary" : ""} onClick={() => reset().then(() => setMode("bin"))}>
            {tt("Bin → Bags", "Bin → Bags", "Bin → Bag")}
          </button>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="primary"
              onClick={async () => {
                setStatus("");
                setError("");
                await stopScanner();
                setTimeout(() => startScanner(), 150);
              }}
            >
              {tt("Start Scanning", "Iniciar escaneo", "Bắt đầu quét")}
            </button>
            <button onClick={reset}>{t("reset")}</button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div id="storage-reader" />
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div>
            <strong>{t("parent_label")}</strong> {parent || "-"}
          </div>

          {parent && (
            <>
              <div>
                <strong>{t("existing_records")}</strong>{" "}
                {childrenExisting.length ? childrenExisting.length : 0}
              </div>

              {childrenExisting.length > 0 && (
                <div
                  style={{
                    maxHeight: 160,
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
                  {childrenExisting.map((c) => (
                    <div
                      key={c}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: "#fff",
                        fontWeight: 700,
                      }}
                    >
                      {c}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{t("add_scanned")}</strong> {childrenScanned.length}

                <button
                  onClick={() => setChildrenScanned([])}
                  disabled={childrenScanned.length === 0}
                >
                  {t("clear_scans")}
                </button>

                <button className="primary" onClick={saveToSheet}>
                  {t("save_to_sheet")}
                </button>
              </div>

              {childrenScanned.length > 0 && (
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
                  {childrenScanned.map((c) => (
                    <div
                      key={c}
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
                      <span style={{ fontWeight: 700 }}>{c}</span>
                      <button onClick={() => setChildrenScanned((prev) => prev.filter((x) => x !== c))} style={{ padding: "2px 8px" }}>
                        {t("remove")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
