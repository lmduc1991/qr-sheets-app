import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadSettings, saveSettings, clearSettings } from "../store/settingsStore";
import { getHeaders } from "../api/sheetsApi";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

export default function SetupPage() {
  const nav = useNavigate();
  const existing = useMemo(() => loadSettings(), []);

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

    if (!proxyUrl.trim()) return setError("Proxy URL is required (Cloudflare Worker URL).");
    if (!itemsSpreadsheetId) return setError("Items Sheet link invalid (cannot find spreadsheet ID).");
    if (!itemsSheetName.trim()) return setError("Items tab name is required.");

    // Save proxy so API calls work
    saveSettings({ proxyUrl: proxyUrl.trim() });

    setLoading(true);
    try {
      const h = await getHeaders(itemsSpreadsheetId, itemsSheetName.trim());
      setHeaders(h);
      if (!keyColumn && h.length) setKeyColumn(h[0]);
      setMsg("Columns loaded. Please choose Key Column.");
    } catch (e) {
      setError(e.message || "Failed to load columns.");
    } finally {
      setLoading(false);
    }
  };

  const saveAll = () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError("Proxy URL is required.");
    if (!itemsSpreadsheetId) return setError("Items Sheet link invalid.");
    if (!itemsSheetName.trim()) return setError("Items tab name is required.");
    if (!keyColumn.trim()) return setError("Key Column is required. Click Load Columns first.");

    const next = {
      proxyUrl: proxyUrl.trim(),

      itemsUrl,
      itemsSpreadsheetId,
      itemsSheetName: itemsSheetName.trim(),
      keyColumn: keyColumn.trim(),
    };

    saveSettings(next);
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

    setMsg("Cleared saved settings.");
    setError("");
  };

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <h2>Setup</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <div className="card">
        <h3>1) Proxy URL</h3>
        <label className="field">
          Cloudflare Worker URL
          <input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://xxxx.workers.dev"
          />
        </label>
      </div>

      <div className="card">
        <h3>2) Items Sheet (942 - Vine Master Inventory)</h3>
        <label className="field">
          Google Sheet link
          <input
            value={itemsUrl}
            onChange={(e) => setItemsUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          Tab name
          <input value={itemsSheetName} onChange={(e) => setItemsSheetName(e.target.value)} />
        </label>

        <button onClick={loadColumns} disabled={loading}>
          {loading ? "Loading..." : "Load Columns"}
        </button>

        {headers.length > 0 && (
          <label className="field" style={{ marginTop: 10 }}>
            Key Column (QR contains this value)
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
        <h3>3) Harvest Log Sheet (2026 Harvesting Log)</h3>
        <label className="field">
          Google Sheet link
          <input
            value={harvestUrl}
            onChange={(e) => setHarvestUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <label className="field">
          Tab name
          <input value={harvestSheetName} onChange={(e) => setHarvestSheetName(e.target.value)} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={saveAll} className="primary">
          Save Setup
        </button>
        <button onClick={doClear}>Clear Saved Setup</button>
      </div>
    </div>
  );
}
