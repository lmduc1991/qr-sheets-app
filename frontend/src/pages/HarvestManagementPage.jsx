// src/pages/HarvestManagementPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, onSettingsChange, saveSettings } from "../store/settingsStore";
import {
  getItemByKey,
  appendHarvestLog,
  getHarvestLogByKey,
  updateHarvestLogByRow,
  getSheetTabs,
} from "../api/sheetsApi";
import { getPhotoCount } from "../store/harvestStore";
import HarvestCapture from "../components/HarvestCapture";
import ExportHarvestZipButton from "../components/ExportHarvestZipButton";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

export default function HarvestManagementPage() {
  const [settings, setSettings] = useState(() => loadSettings());

  useEffect(() => {
    return onSettingsChange((s) => setSettings(s));
  }, []);

  const keyColumn = settings?.keyColumn || "";
  const proxyUrl = settings?.proxyUrl || "";

  // Harvest Setup (inside Harvest page)
  const [harvestUrl, setHarvestUrl] = useState(settings?.harvestUrl || "");
  const [harvestSheetName, setHarvestSheetName] = useState(settings?.harvestSheetName || "");
  const [harvestTabs, setHarvestTabs] = useState([]);
  const [hSetupLoading, setHSetupLoading] = useState(false);
  const [hSetupMsg, setHSetupMsg] = useState("");
  const [hSetupErr, setHSetupErr] = useState("");

  const harvestSpreadsheetId = extractSpreadsheetId(harvestUrl);
  const hasHarvestSetup = !!settings?.harvestSpreadsheetId && !!settings?.harvestSheetName;

  // App flow
  const [step, setStep] = useState("idle"); // idle | scanItem | viewItem | verify | form
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [item, setItem] = useState(null);
  const [headers, setHeaders] = useState([]);

  const [harvestExists, setHarvestExists] = useState(false);
  const [harvestRow, setHarvestRow] = useState(null);
  const [formMode, setFormMode] = useState("create"); // create | view | edit

  const [form, setForm] = useState({
    harvestingDate: today(),
    numberOfShoot: "",
    shoot1Length: "",
    shoot2Length: "",
  });

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  };

  const startScanner = (domId, onScanOnce) => {
    if (scannerRef.current) return;

    const el = document.getElementById(domId);
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      domId,
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const key = String(decodedText || "").trim();
        if (!key) return;
        await stopScanner();
        onScanOnce(key);
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const loadHarvestTabs = async () => {
    setHSetupErr("");
    setHSetupMsg("");

    if (!proxyUrl.trim()) return setHSetupErr("Proxy URL is missing. Go to Setup first.");
    if (!harvestSpreadsheetId) return setHSetupErr("Harvest sheet link invalid.");

    setHSetupLoading(true);
    try {
      const tabs = await getSheetTabs(harvestSpreadsheetId);
      setHarvestTabs(tabs);
      setHSetupMsg("Tabs loaded. Choose the Harvest tab then Save.");
    } catch (e) {
      setHSetupErr(e.message || "Failed to load tabs.");
    } finally {
      setHSetupLoading(false);
    }
  };

  const saveHarvestSetup = () => {
    setHSetupErr("");
    setHSetupMsg("");

    if (!harvestSpreadsheetId) return setHSetupErr("Harvest sheet link invalid.");
    if (!harvestSheetName.trim()) return setHSetupErr("Harvest tab is required.");

    saveSettings({
      harvestUrl,
      harvestSpreadsheetId,
      harvestSheetName: harvestSheetName.trim(),
    });

    setHSetupMsg("Harvest setup saved. You can start scanning now.");
  };

  const resetStateForNewScan = () => {
    setStatus("");
    setError("");
    setItemKey("");
    setItem(null);
    setHeaders([]);
    setHarvestExists(false);
    setHarvestRow(null);
    setFormMode("create");
    setForm({
      harvestingDate: today(),
      numberOfShoot: "",
      shoot1Length: "",
      shoot2Length: "",
    });
  };

  const beginScanItem = async () => {
    // Must have harvest setup before scanning
    const s = loadSettings();
    if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
      alert("Harvest sheet is not set. Please set it up in Harvest Management first.");
      return;
    }

    resetStateForNewScan();
    setStep("scanItem");
    await stopScanner();

    setTimeout(() => {
      startScanner("harvest-item-reader", async (key) => {
        setError("");
        setStatus("Loading item...");
        try {
          const r = await getItemByKey(key);
          setHeaders(r.headers || []);
          if (!r.found) throw new Error("Item not found in MASTER LIST.");

          setItemKey(key);
          setItem(r.item);

          setStatus("Checking Harvest Log...");
          const hr = await getHarvestLogByKey(key);
          if (hr?.found) {
            setHarvestExists(true);
            setHarvestRow(hr.rowIndex);
            setForm({
              harvestingDate: hr.data.harvestingDate || today(),
              numberOfShoot: hr.data.numberOfShoot || "",
              shoot1Length: hr.data.shoot1Length || "",
              shoot2Length: hr.data.shoot2Length || "",
            });
            setFormMode("view");
            setStatus("Item loaded (already in Harvest Log).");
          } else {
            setHarvestExists(false);
            setFormMode("create");
            setStatus("Item loaded.");
          }

          setStep("viewItem");
        } catch (e) {
          setStatus("");
          setError(e.message || "Failed to load item.");
          setStep("scanItem");
        }
      });
    }, 150);
  };

  const beginVerify = async () => {
    setError("");
    setStatus("Scan Harvest Label QR (must match item).");
    setStep("verify");
    await stopScanner();

    setTimeout(() => {
      startScanner("harvest-label-reader", async (harvestKey) => {
        if (harvestKey === itemKey) {
          setError("");
          setStatus("Matched. Continue to harvest form.");
          setFormMode("create");
          setStep("form");
          return;
        }

        alert("QR not match, please scan another");
        beginVerify();
      });
    }, 150);
  };

  const openExistingHarvestForm = () => {
    setError("");
    setStatus("Loaded Harvest form from log.");
    setStep("form");
    setFormMode("view");
  };

  const saveHarvest = async () => {
    setError("");
    setStatus(formMode === "edit" ? "Saving changes..." : "Saving harvest log...");

    try {
      const photoCount = getPhotoCount(itemKey);

      if (formMode === "edit") {
        if (harvestRow == null) throw new Error("Cannot edit: missing harvest row reference.");

        await updateHarvestLogByRow({
          rowIndex: harvestRow,
          itemKey,
          harvestingDate: form.harvestingDate,
          numberOfShoot: form.numberOfShoot,
          shoot1Length: form.shoot1Length,
          shoot2Length: form.shoot2Length,
          photoCount,
        });

        setStatus("Updated Harvesting Log. Ready for next scan.");
      } else {
        await appendHarvestLog({
          itemKey,
          harvestingDate: form.harvestingDate,
          numberOfShoot: form.numberOfShoot,
          shoot1Length: form.shoot1Length,
          shoot2Length: form.shoot2Length,
          photoCount,
        });

        setStatus("Saved to Harvesting Log. Ready for next scan.");
      }

      await beginScanItem();
    } catch (e) {
      setStatus("");
      setError(e.message || "Failed to save harvest log.");
    }
  };

  if (!proxyUrl) return <div className="page">Please go to Setup first.</div>;

  return (
    <div className="page">
      <h2>Harvest Management</h2>

      {/* Harvest Setup Panel */}
      <div className="card">
        <h3>Harvest Setup</h3>

        {hSetupErr && <div className="alert alert-error">{hSetupErr}</div>}
        {hSetupMsg && <div className="alert alert-ok">{hSetupMsg}</div>}

        <label className="field">
          Harvest Google Sheet link
          <input
            value={harvestUrl}
            onChange={(e) => setHarvestUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={loadHarvestTabs} disabled={hSetupLoading || !harvestSpreadsheetId}>
            {hSetupLoading ? "Loading..." : "Load Tabs"}
          </button>

          <button onClick={saveHarvestSetup} disabled={!harvestSpreadsheetId || !harvestSheetName.trim()}>
            Save Harvest Setup
          </button>
        </div>

        <label className="field" style={{ marginTop: 10 }}>
          Harvest tab
          {harvestTabs.length ? (
            <select value={harvestSheetName} onChange={(e) => setHarvestSheetName(e.target.value)}>
              <option value="">(choose tab)</option>
              {harvestTabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={harvestSheetName}
              onChange={(e) => setHarvestSheetName(e.target.value)}
              placeholder="Harvesting Log"
            />
          )}
        </label>

        {!hasHarvestSetup && (
          <div className="alert" style={{ marginTop: 10 }}>
            Harvest is not configured yet. Please set it up above before scanning.
          </div>
        )}
      </div>

      {/* Export ZIP always visible */}
      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ExportHarvestZipButton />
      </div>

      {/* Inline status + error */}
      {(status || error) && (
        <div className="card" style={{ marginTop: 10 }}>
          {status && <div className="alert">{status}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      )}

      {step === "idle" && (
        <div className="card">
          <p>Camera will only start when you press Start Scanning.</p>
          <button className="primary" onClick={beginScanItem} disabled={!hasHarvestSetup}>
            Start Scanning
          </button>
        </div>
      )}

      {step === "scanItem" && (
        <div className="card">
          <p>
            Scan Item QR (Key Column: <strong>{keyColumn}</strong>)
          </p>
          <div id="harvest-item-reader" />
          <button style={{ marginTop: 10 }} onClick={() => setStep("idle")}>
            Stop
          </button>
        </div>
      )}

      {step === "viewItem" && (
        <div className="card">
          <div>
            <strong>Scanned Key:</strong> {itemKey}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              className="primary"
              onClick={beginVerify}
              disabled={harvestExists}
              style={harvestExists ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              Harvest
            </button>

            {harvestExists && <button onClick={openExistingHarvestForm}>Harvest form</button>}

            <button onClick={beginScanItem}>Scan Another Item</button>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>Item details</h4>
            <PrettyDetails item={item} preferredOrder={headers} />
          </div>

          {harvestExists && (
            <div className="alert" style={{ marginTop: 12 }}>
              This item already exists in Harvesting Log. Use “Harvest form” to view/edit.
            </div>
          )}
        </div>
      )}

      {step === "verify" && (
        <div className="card">
          <p>
            Scan <strong>Harvest Label</strong> QR. It must match item key: <strong>{itemKey}</strong>
          </p>
          <div id="harvest-label-reader" />
          <button style={{ marginTop: 10 }} onClick={beginVerify}>
            Scan Again
          </button>
        </div>
      )}

      {step === "form" && (
        <div className="card">
          <h3>Harvest Form</h3>

          {formMode === "view" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="primary" onClick={() => setFormMode("edit")}>
                Edit
              </button>
              <button onClick={beginScanItem}>Back to Scan</button>
            </div>
          )}

          <div className="grid">
            <label className="field">
              Harvesting Date
              <input
                type="date"
                value={form.harvestingDate}
                disabled={formMode === "view"}
                onChange={(e) => setForm((prev) => ({ ...prev, harvestingDate: e.target.value }))}
              />
            </label>

            <label className="field">
              Number of shoot
              <input
                type="number"
                value={form.numberOfShoot}
                disabled={formMode === "view"}
                onChange={(e) => setForm((prev) => ({ ...prev, numberOfShoot: e.target.value }))}
              />
            </label>

            <label className="field">
              Shoot 1 length
              <input
                value={form.shoot1Length}
                disabled={formMode === "view"}
                onChange={(e) => setForm((prev) => ({ ...prev, shoot1Length: e.target.value }))}
              />
            </label>

            <label className="field">
              Shoot 2 length
              <input
                value={form.shoot2Length}
                disabled={formMode === "view"}
                onChange={(e) => setForm((prev) => ({ ...prev, shoot2Length: e.target.value }))}
              />
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>Photos</h4>
            <HarvestCapture itemId={itemKey} />
          </div>

          {formMode !== "view" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="primary" onClick={saveHarvest}>
                {formMode === "edit" ? "Save Changes" : "Save Harvest Log"}
              </button>
              <button onClick={beginScanItem}>Cancel / Scan Another</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
