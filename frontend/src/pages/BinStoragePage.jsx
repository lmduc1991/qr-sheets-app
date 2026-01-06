// src/pages/BinStoragePage.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import netlifyIdentity from "netlify-identity-widget";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import { getSheetTabs, appendBagStorage, appendBinStorage } from "../api/sheetsApi";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function uniq(arr) {
  return Array.from(new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)));
}

export default function BinStoragePage() {
  // Reactive settings (like Harvest page)
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  // Setup states
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

  const storageReady =
    !!settings?.storageSpreadsheetId && !!settings?.bagStorageSheetName && !!settings?.binStorageSheetName;

  const loadTabs = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl) return setSetupErr("Missing Proxy URL. Go to Setup first.");
    if (!storageSpreadsheetId) return setSetupErr("Storage Sheet link invalid (cannot find spreadsheet ID).");

    setTabsLoading(true);
    try {
      const list = await getSheetTabs(storageSpreadsheetId);
      setTabs(list);

      // Gentle defaults if user hasn't picked yet
      if (!bagStorageSheetName) {
        const d = list.find((n) => n.toLowerCase().includes("bag")) || "";
        if (d) setBagStorageSheetName(d);
      }
      if (!binStorageSheetName) {
        const d = list.find((n) => n.toLowerCase().includes("bin")) || "";
        if (d) setBinStorageSheetName(d);
      }

      setSetupMsg(`Loaded ${list.length} tab(s). Choose where to write Bag and Bin scans.`);
    } catch (e) {
      setSetupErr(e.message || "Failed to load sheet tabs.");
    } finally {
      setTabsLoading(false);
    }
  };

  const saveStorageSetup = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl) return setSetupErr("Missing Proxy URL. Go to Setup first.");
    if (!storageSpreadsheetId) return setSetupErr("Storage Sheet link invalid (cannot find spreadsheet ID).");
    if (!String(bagStorageSheetName || "").trim()) return setSetupErr("Select a tab for Bag scans.");
    if (!String(binStorageSheetName || "").trim()) return setSetupErr("Select a tab for Bin scans.");

    setSetupSaving(true);
    try {
      saveSettings({
        storageUrl,
        storageSpreadsheetId,
        bagStorageSheetName: bagStorageSheetName.trim(),
        binStorageSheetName: binStorageSheetName.trim(),
      });
      setSetupMsg("Bin Storage settings saved.");
      setSetupOpen(false);
    } catch (e) {
      setSetupErr(e.message || "Failed to save Bin Storage settings.");
    } finally {
      setSetupSaving(false);
    }
  };

  // ---------------------------
  // Scan workflow
  // ---------------------------
  // mode: bag -> vines OR bin -> bags
  const [mode, setMode] = useState("bag");
  // step: idle | scanParent | scanChildren
  const [step, setStep] = useState("idle");

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [parentLabel, setParentLabel] = useState("");
  const [children, setChildren] = useState([]);

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  };

  const startScanner = (domId, onScan) => {
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
        const v = String(decodedText || "").trim();
        if (!v) return;
        onScan(v);
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const resetFlow = async () => {
    await stopScanner();
    setStatus("");
    setError("");
    setParentLabel("");
    setChildren([]);
    setStep("idle");
  };

  const begin = async () => {
    setError("");
    setStatus("");

    if (!storageReady) {
      setError("Storage settings missing. Open Bin Storage Settings and complete setup first.");
      return;
    }

    await resetFlow();

    setStep("scanParent");
    setStatus(mode === "bag" ? "Scan Bag label first." : "Scan Bin label first.");

    setTimeout(() => {
      startScanner("storage-parent-reader", async (label) => {
        await stopScanner();
        setParentLabel(label);
        setChildren([]);
        setStep("scanChildren");
        setStatus(mode === "bag" ? "Now bulk scan Vine labels into this Bag." : "Now bulk scan Bag labels into this Bin.");

        setTimeout(() => {
          startScanner("storage-children-reader", (child) => {
            setChildren((prev) => uniq([...prev, child]));
          });
        }, 120);
      });
    }, 120);
  };

  const removeChild = (v) => setChildren((prev) => prev.filter((x) => x !== v));

  const save = async () => {
    setError("");
    setStatus("");

    if (!parentLabel.trim()) return setError("Missing parent label. Scan Bag/Bin first.");
    if (children.length === 0) return setError("No scanned items yet.");

    setStatus("Saving…");
    try {
      const user = netlifyIdentity.currentUser();
      if (!user) throw new Error("You are not logged in. Please login again.");

      if (mode === "bag") {
        await appendBagStorage({ bagLabel: parentLabel.trim(), vineIds: children });
        setStatus("Saved Bag → Vines. Ready for next bag.");
      } else {
        await appendBinStorage({ binLabel: parentLabel.trim(), bagLabels: children });
        setStatus("Saved Bin → Bags. Ready for next bin.");
      }

      // Immediately continue for next parent
      await begin();
    } catch (e) {
      setStatus("");
      setError(e.message || "Save failed.");
    }
  };

  if (!settings?.proxyUrl) return <div className="page">Please go to Setup first.</div>;

  return (
    <div className="page">
      <h2>Bin Storage</h2>

      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => {
            setSetupOpen((v) => !v);
            setSetupErr("");
            setSetupMsg("");
          }}
        >
          {setupOpen ? "Close Bin Storage Settings" : "Bin Storage Settings"}
        </button>
      </div>

      {(setupOpen || !storageReady) && (
        <div className="card" style={{ marginTop: 10 }}>
          <h3>Bin Storage Sheet Setup</h3>

          {setupErr && <div className="alert alert-error">{setupErr}</div>}
          {setupMsg && <div className="alert alert-ok">{setupMsg}</div>}

          <label className="field">
            Google Sheet link (contains your storage tabs)
            <input
              value={storageUrl}
              onChange={(e) => setStorageUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary" onClick={loadTabs} disabled={tabsLoading || !storageSpreadsheetId}>
              {tabsLoading ? "Loading Tabs…" : "Load Tabs"}
            </button>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="field">
              Bag scan → write to tab
              <select value={bagStorageSheetName} onChange={(e) => setBagStorageSheetName(e.target.value)}>
                <option value="">-- Select tab --</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Bin scan → write to tab
              <select value={binStorageSheetName} onChange={(e) => setBinStorageSheetName(e.target.value)}>
                <option value="">-- Select tab --</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="primary" onClick={saveStorageSetup} disabled={setupSaving}>
            {setupSaving ? "Saving..." : "Save Bin Storage Setup"}
          </button>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
            Tip: Create tabs first in Google Sheets, then click “Load Tabs”, then choose where each scan mode writes.
          </div>
        </div>
      )}

      {(status || error) && (
        <div className="card" style={{ marginTop: 10 }}>
          {status && <div className="alert">{status}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      )}

      {step === "idle" && (
        <div className="card">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className={mode === "bag" ? "primary" : ""} onClick={() => setMode("bag")}>
              Bag → Vines
            </button>
            <button className={mode === "bin" ? "primary" : ""} onClick={() => setMode("bin")}>
              Bin → Bags
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <p>Ready. Click Start Scanning.</p>
            <button className="primary" onClick={begin} disabled={!storageReady}>
              Start Scanning
            </button>
            {!storageReady && (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
                Please complete Bin Storage setup above first.
              </div>
            )}
          </div>
        </div>
      )}

      {step === "scanParent" && (
        <div className="card">
          <p>{mode === "bag" ? "Scan Bag Label" : "Scan Bin Label"}</p>
          <div id="storage-parent-reader" />
          <button style={{ marginTop: 10 }} onClick={resetFlow}>
            Stop
          </button>
        </div>
      )}

      {step === "scanChildren" && (
        <div className="card">
          <div style={{ fontWeight: 800 }}>
            Parent: <span style={{ fontWeight: 700 }}>{parentLabel}</span>
          </div>

          <p style={{ marginTop: 8 }}>
            {mode === "bag" ? "Now scan vine labels (bulk)" : "Now scan bag labels (bulk)"}.
            Scanned: <strong>{children.length}</strong>
          </p>

          <div id="storage-children-reader" />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button
              onClick={() => {
                setChildren([]);
                setStatus("Cleared scans.");
              }}
            >
              Clear Scans
            </button>

            <button className="primary" onClick={save} disabled={!parentLabel || children.length === 0}>
              Save
            </button>

            <button onClick={resetFlow}>Done</button>
          </div>

          {children.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Scanned</div>
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
                {children.map((v) => (
                  <div
                    key={v}
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
                    <span style={{ fontWeight: 700 }}>{v}</span>
                    <button onClick={() => removeChild(v)} style={{ padding: "2px 8px" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
