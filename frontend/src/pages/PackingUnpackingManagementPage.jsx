import { useMemo, useState } from "react";
import { loadSettings, saveSettings } from "../store/settingsStore";
import { getSheetTabs } from "../api/sheetsApi";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

const MODES = [
  { id: "or-pack", label: "OR-Packing", needs: "or" },
  { id: "or-unpack", label: "OR-Unpacking", needs: "or" },
  { id: "graft-pack", label: "Grafting-Packing", needs: "grafting" },
  { id: "graft-unpack", label: "Grafting-Unpacking", needs: "grafting" },
];

export default function PackingUnpackingManagementPage() {
  const base = useMemo(() => loadSettings(), []);

  const [packingUrl, setPackingUrl] = useState(base?.packingUrl || "");
  const [packingOrSheetName, setPackingOrSheetName] = useState(base?.packingOrSheetName || "");
  const [packingGraftingSheetName, setPackingGraftingSheetName] = useState(
    base?.packingGraftingSheetName || ""
  );

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [mode, setMode] = useState(null);

  const proxyUrl = base?.proxyUrl || "";
  const packingSpreadsheetId = extractSpreadsheetId(packingUrl);

  const loadTabs = async () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError("Proxy URL is not set. Please complete Setup first.");
    if (!packingSpreadsheetId) return setError("Packing Sheet link invalid (cannot find spreadsheet ID).");

    // ensure proxyUrl present in store (if user edited it elsewhere)
    saveSettings({ proxyUrl: proxyUrl.trim() });

    setLoadingTabs(true);
    try {
      const t = await getSheetTabs(packingSpreadsheetId);
      setTabs(t);
      setMsg("Tabs loaded. Choose OR and/or GRAFTING.");
    } catch (e) {
      setError(e.message || "Failed to load tabs.");
    } finally {
      setLoadingTabs(false);
    }
  };

  const savePackingSetup = () => {
    setError("");
    setMsg("");

    if (!packingSpreadsheetId) return setError("Packing Sheet link invalid (cannot find spreadsheet ID).");

    saveSettings({
      packingUrl,
      packingSpreadsheetId,
      packingOrSheetName: packingOrSheetName.trim(),
      packingGraftingSheetName: packingGraftingSheetName.trim(),
    });

    setMsg("Packing/Unpacking setup saved.");
  };

  const ensureTabForMode = (needs) => {
    if (!packingSpreadsheetId) {
      alert("Packing Sheet is not set. Please paste the Packing Sheet link and Save.");
      return false;
    }
    if (needs === "or" && !packingOrSheetName.trim()) {
      alert('OR tab is not set. Please choose the tab for "OR" and Save.');
      return false;
    }
    if (needs === "grafting" && !packingGraftingSheetName.trim()) {
      alert('GRAFTING tab is not set. Please choose the tab for "GRAFTING" and Save.');
      return false;
    }
    return true;
  };

  const start = (m) => {
    // requirement: if tab not configured, prompt user to configure (no silent fail)
    if (!ensureTabForMode(m.needs)) return;
    setMode(m.id);
    // next step: start scanner flow
    alert(`Next step: implement scanner flow for ${m.label}.`);
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>Packing / Unpacking Management</h2>

      {!proxyUrl.trim() && (
        <div className="alert alert-error">
          Proxy URL is not set. Please go to Setup and save your Cloudflare Worker URL.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <div className="card">
        <h3>Setup (Packing Sheet)</h3>

        <label className="field">
          Google Sheet link
          <input
            value={packingUrl}
            onChange={(e) => setPackingUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={loadTabs} disabled={loadingTabs || !packingSpreadsheetId || !proxyUrl.trim()}>
            {loadingTabs ? "Loading..." : "Load Tabs"}
          </button>
          <button onClick={savePackingSetup} disabled={!packingSpreadsheetId}>
            Save Packing Setup
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="field">
            OR tab (used for OR-Packing / OR-Unpacking)
            {tabs.length ? (
              <select value={packingOrSheetName} onChange={(e) => setPackingOrSheetName(e.target.value)}>
                <option value="">(not set)</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input value={packingOrSheetName} onChange={(e) => setPackingOrSheetName(e.target.value)} placeholder="OR" />
            )}
          </label>

          <label className="field">
            GRAFTING tab (used for Grafting-Packing / Grafting-Unpacking)
            {tabs.length ? (
              <select
                value={packingGraftingSheetName}
                onChange={(e) => setPackingGraftingSheetName(e.target.value)}
              >
                <option value="">(not set)</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={packingGraftingSheetName}
                onChange={(e) => setPackingGraftingSheetName(e.target.value)}
                placeholder="GRAFTING"
              />
            )}
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
          OR and GRAFTING are optional. If you start an action without its tab configured, the app will prompt you to set it.
        </div>
      </div>

      <div className="card">
        <h3>Choose operation</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => start(m)} className={mode === m.id ? "primary" : ""}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
