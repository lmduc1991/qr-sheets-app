import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadSettings, saveSettings, clearSettings } from "../store/settingsStore";
import { getHeaders } from "../api/sheetsApi";
import { useI18n } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

export default function SetupPage() {
  const nav = useNavigate();
  const existing = useMemo(() => loadSettings(), []);
  const { lang, setLang, t } = useI18n();

  const [proxyUrl, setProxyUrl] = useState(existing?.proxyUrl || "");

  const [itemsUrl, setItemsUrl] = useState(existing?.itemsUrl || "");
  const [itemsSheetName, setItemsSheetName] = useState(existing?.itemsSheetName || "MASTER LIST");

  const [headers, setHeaders] = useState([]);
  const [keyColumn, setKeyColumn] = useState(existing?.keyColumn || "");

  const [harvestUrl, setHarvestUrl] = useState(existing?.harvestUrl || "");
  const [harvestSheetName, setHarvestSheetName] = useState(existing?.harvestSheetName || "Harvesting Log");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const itemsSpreadsheetId = extractSpreadsheetId(itemsUrl);
  const harvestSpreadsheetId = extractSpreadsheetId(harvestUrl);

  const loadColumns = async () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError(t("err_proxy_required"));
    if (!itemsSpreadsheetId) return setError(t("err_items_link_invalid"));
    if (!itemsSheetName.trim()) return setError(t("err_items_tab_required"));

    // Save proxy so API calls work
    saveSettings({ proxyUrl: proxyUrl.trim() });

    setLoading(true);
    try {
      const h = await getHeaders(itemsSpreadsheetId, itemsSheetName.trim());
      setHeaders(h);
      if (!keyColumn && h.length) setKeyColumn(h[0]);
      setMsg(t("msg_columns_loaded"));
    } catch (e) {
      setError(e.message || "Failed to load columns.");
    } finally {
      setLoading(false);
    }
  };

  const saveAll = () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError(t("err_proxy_required"));
    if (!itemsSpreadsheetId) return setError(t("err_items_link_invalid"));
    if (!harvestSpreadsheetId) return setError(t("err_harvest_link_invalid"));
    if (!itemsSheetName.trim()) return setError(t("err_items_tab_required"));
    if (!harvestSheetName.trim()) return setError(t("err_harvest_tab_required"));
    if (!keyColumn.trim()) return setError(t("err_key_required"));

    saveSettings({
      language: lang,

      proxyUrl: proxyUrl.trim(),

      itemsUrl,
      itemsSpreadsheetId,
      itemsSheetName: itemsSheetName.trim(),
      keyColumn: keyColumn.trim(),

      harvestUrl,
      harvestSpreadsheetId,
      harvestSheetName: harvestSheetName.trim(),
    });

    nav("/items", { replace: true });
  };

  const doClear = () => {
    clearSettings();
    setProxyUrl("");
    setItemsUrl("");
    setItemsSheetName("MASTER LIST");
    setHeaders([]);
    setKeyColumn("");
    setHarvestUrl("");
    setHarvestSheetName("Harvesting Log");
    setMsg(t("msg_cleared"));
    setError("");
  };

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <h2>{t("setup_title")}</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <div className="card">
        <h3>{t("setup_language_title")}</h3>
        <label className="field">
          {t("setup_language_label")}
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">{t("lang_en")}</option>
            <option value="vi">{t("lang_vi")}</option>
            <option value="es">{t("lang_es")}</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h3>{t("setup_proxy_title")}</h3>
        <label className="field">
          {t("setup_proxy_label")}
          <input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://xxxx.workers.dev"
          />
        </label>
      </div>

      <div className="card">
        <h3>{t("setup_items_title")}</h3>
        <label className="field">
          {t("setup_sheet_link")}
          <input
            value={itemsUrl}
            onChange={(e) => setItemsUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          {t("setup_tab_name")}
          <input value={itemsSheetName} onChange={(e) => setItemsSheetName(e.target.value)} />
        </label>

        <button onClick={loadColumns} disabled={loading}>
          {loading ? t("setup_loading") : t("setup_load_columns")}
        </button>

        {headers.length > 0 && (
          <label className="field" style={{ marginTop: 10 }}>
            {t("setup_key_column")}
            <select value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)}>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="card">
        <h3>{t("setup_harvest_title")}</h3>
        <label className="field">
          {t("setup_sheet_link")}
          <input
            value={harvestUrl}
            onChange={(e) => setHarvestUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          {t("setup_tab_name")}
          <input value={harvestSheetName} onChange={(e) => setHarvestSheetName(e.target.value)} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={saveAll} className="primary">
          {t("setup_save")}
        </button>
        <button onClick={doClear}>{t("setup_clear")}</button>
      </div>
    </div>
  );
}
