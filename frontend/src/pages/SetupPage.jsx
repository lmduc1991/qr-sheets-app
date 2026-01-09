import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadSettings, saveSettings, clearSettings, onSettingsChange } from "../store/settingsStore";
import { getHeaders } from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

export default function SetupPage() {
  const { t } = useT();
  const nav = useNavigate();

  const existing = useMemo(() => loadSettings(), []);
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const [language, setLanguage] = useState(existing?.language || "en");

  useEffect(() => {
    if (settings?.language && settings.language !== language) setLanguage(settings.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.language]);

  const applyLanguage = (val) => {
    const v = String(val || "en").trim() || "en";
    setLanguage(v);
    saveSettings({ language: v }); // immediate
  };

  const [proxyUrl, setProxyUrl] = useState(existing?.proxyUrl || "");

  const [itemsUrl, setItemsUrl] = useState(existing?.itemsUrl || "");
  const [itemsSheetName, setItemsSheetName] = useState(existing?.itemsSheetName || "MASTER LIST");

  const [headers, setHeaders] = useState([]);
  const [keyColumn, setKeyColumn] = useState(existing?.keyColumn || "");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const itemsSpreadsheetId = extractSpreadsheetId(itemsUrl);

  const loadColumns = async () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError(t("setup_err_proxy_required"));
    if (!itemsSpreadsheetId) return setError(t("setup_err_items_link_invalid"));
    if (!itemsSheetName.trim()) return setError(t("setup_err_items_tab_required"));

    // Save proxy so API calls work
    saveSettings({ proxyUrl: proxyUrl.trim() });

    setLoading(true);
    try {
      const h = await getHeaders(itemsSpreadsheetId, itemsSheetName.trim());
      setHeaders(h);
      if (!keyColumn && h.length) setKeyColumn(h[0]);
      setMsg(t("columns_loaded_choose_key"));
    } catch (e) {
      setError(e.message || t("failed_load_columns"));
    } finally {
      setLoading(false);
    }
  };

  const saveAll = () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError(t("setup_err_proxy_required_short"));
    if (!itemsSpreadsheetId) return setError(t("setup_err_items_invalid_short"));
    if (!itemsSheetName.trim()) return setError(t("setup_err_items_tab_required"));
    if (!keyColumn.trim()) return setError(t("setup_err_key_required"));

    saveSettings({
      language,

      proxyUrl: proxyUrl.trim(),

      itemsUrl,
      itemsSpreadsheetId,
      itemsSheetName: itemsSheetName.trim(),
      keyColumn: keyColumn.trim(),
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
    setMsg(t("cleared_saved_settings"));
    setError("");

    // keep language consistent
    setLanguage("en");
    saveSettings({ language: "en" });
  };

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <h2>{t("setup_title")}</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <div className="card">
        <h3>{t("language")}</h3>
        <label className="field">
          {t("language")}
          <select value={language} onChange={(e) => applyLanguage(e.target.value)}>
            <option value="en">{t("english")}</option>
            <option value="es">{t("spanish")}</option>
            <option value="vi">{t("vietnamese")}</option>
          </select>
        </label>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{t("language_applies_immediately")}</div>
      </div>

      <div className="card">
        <h3>{t("proxy_url_title")}</h3>
        <label className="field">
          {t("proxy_url_label")}
          <input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={t("proxy_url_placeholder")}
          />
        </label>
      </div>

      <div className="card">
        <h3>{t("items_sheet_title")}</h3>
        <label className="field">
          {t("google_sheet_link")}
          <input
            value={itemsUrl}
            onChange={(e) => setItemsUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          {t("tab_name")}
          <input value={itemsSheetName} onChange={(e) => setItemsSheetName(e.target.value)} />
        </label>

        <button onClick={loadColumns} disabled={loading}>
          {loading ? t("loading") : t("load_columns")}
        </button>

        {headers.length > 0 && (
          <label className="field" style={{ marginTop: 10 }}>
            {t("key_column_label")}
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
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          {t("harvest_setup_note")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={saveAll} className="primary">
          {t("save_setup")}
        </button>
        <button onClick={doClear}>{t("clear_saved_setup")}</button>
      </div>
    </div>
  );
}
