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
  const proxyUrl = base?.proxyUrl || "";

  const [packingUrl, setPackingUrl] = useState(base?.packingUrl || "");
  const [orSheetName, setOrSheetName] = useState(base?.packingOrSheetName || "");
  const [graftingSheetName, setGraftingSheetName] = useState(base?.packingGraftingSheetName || "");

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const packingSpreadsheetId = extractSpreadsheetId(packingUrl);

  const loadTabs = async () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError("Proxy URL is missing. Go to Setup first.");
    if (!packingSpreadsheetId) return setError("Packing sheet link invalid (cannot find spreadsheet ID).");

    setLoadingTabs(true);
    try {
      const t = await getSheetTabs(packingSpreadsheetId);
      setTabs(t);
      setMsg("Tabs loaded. Choose OR and/or GRAFTING then Save.");
    } catch (e) {
      setError(e.message || "Failed to load tabs.");
    } finally {
      setLoadingTabs(false);
    }
  };

  const savePackingSetup = () => {
    setError("");
    setMsg("");

    if (!packingSpreadsheetId) return setError("Packing sheet link invalid (cannot find spreadsheet ID).");

    saveSettings({
      packingUrl,
      packingSpreadsheetId,
      packingOrSheetName: orSheetName.trim(),
      packingGraftingSheetName: graftingSheetName.trim(),
    });

    setMsg("Packing/Unpacking setup saved.");
  };

  const ensureTabForMode = (needs) => {
    if (!packingSpreadsheetId) {
      alert("Packing Sheet is not set. Paste the sheet link and Save Packing Setup first.");
      return false;
    }
    if (needs === "or" && !orSheetName.trim()) {
      alert('OR tab is not set. Choose the OR tab and Save Packing Setup.');
      return false;
    }
    if (needs === "grafting" && !graftingSheetName.trim()) {
      alert('GRAFTING tab is not set. Choose the GRAFTING tab and Save Packing Setup.');
      return false;
    }
    return true;
  };

  const start = (m) => {
    if (!ensureTabForMode(m.needs)) return;
    alert(`OK. Next step: implement scanning + forms for "${m.label}".`);
  };

  if (!proxyUrl) return <div className="page">Please go to Setup first.</div>;

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>Packing-Unpacking Management</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <div className="card">
        <h3>Setup (Packing Sheet)</h3>

        <label className="field">
          Packing Google Sheet link
          <input
            value={packingUrl}
            onChange={(e) => setPackingUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={loadTabs} disabled={loadingTabs || !packingSpreadsheetId}>
            {loadingTabs ? "Loading..." : "Load Tabs"}
          </button>
          <button onClick={savePackingSetup} disabled={!packingSpreadsheetId}>
            Save Packing Setup
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="field">
            OR tab (OR-Packing / OR-Unpacking)
            {tabs.length ? (
              <select value={orSheetName} onChange={(e) => setOrSheetName(e.target.value)}>
                <option value="">(not set)</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input value={orSheetName} onChange={(e) => setOrSheetName(e.target.value)} placeholder="OR" />
            )}
          </label>

          <label className="field">
            GRAFTING tab (Grafting-Packing / Grafting-Unpacking)
            {tabs.length ? (
              <select value={graftingSheetName} onChange={(e) => setGraftingSheetName(e.target.value)}>
                <option value="">(not set)</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={graftingSheetName}
                onChange={(e) => setGraftingSheetName(e.target.value)}
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
            <button key={m.id} onClick={() => start(m)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
