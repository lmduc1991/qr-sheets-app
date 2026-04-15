import { useEffect, useMemo, useRef, useState } from "react";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import { getSheetTabs, getHeaders, getLabelCheckRowsByTwoLabels } from "../api/sheetsApi";
import { startQrScanner } from "../utils/qrScanner";

const MULTI_SIZE_MSG = "Multiple Rows Same Size";

function extractSpreadsheetId(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s) && !s.includes("http")) return s;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function popup(msg) {
  try {
    alert(String(msg || ""));
  } catch {
    // ignore
  }
}

function uniqueSizes(rows = []) {
  return Array.from(new Set(rows.map((row) => String(row?.size || "").trim()).filter(Boolean)));
}

function PrettyDetails({ record, preferredOrder = [] }) {
  if (!record) return null;

  const entries = Object.entries(record || {})
    .filter(([k]) => !!k)
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
          <div style={{ wordBreak: "break-word" }}>{String(v ?? "")}</div>
        </div>
      ))}
    </div>
  );
}

export default function LabelCheckPage() {
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [setupErr, setSetupErr] = useState("");
  const [tabsLoading, setTabsLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);

  const [fileUrl, setFileUrl] = useState(settings?.labelCheckFileUrl || "");
  const [sheetName, setSheetName] = useState(settings?.labelCheckSheetName || "");
  const [tabs, setTabs] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [firstLabelColumn, setFirstLabelColumn] = useState(settings?.labelCheckFirstLabelColumn || "");
  const [secondLabelColumn, setSecondLabelColumn] = useState(settings?.labelCheckSecondLabelColumn || "");

  useEffect(() => {
    setFileUrl(settings?.labelCheckFileUrl || "");
    setSheetName(settings?.labelCheckSheetName || "");
    setFirstLabelColumn(settings?.labelCheckFirstLabelColumn || "");
    setSecondLabelColumn(settings?.labelCheckSecondLabelColumn || "");
  }, [
    settings?.labelCheckFileUrl,
    settings?.labelCheckSheetName,
    settings?.labelCheckFirstLabelColumn,
    settings?.labelCheckSecondLabelColumn,
  ]);

  const spreadsheetId = useMemo(() => extractSpreadsheetId(fileUrl), [fileUrl]);
  const ready =
    !!settings?.proxyUrl &&
    !!settings?.labelCheckSpreadsheetId &&
    !!settings?.labelCheckSheetName &&
    !!settings?.labelCheckFirstLabelColumn &&
    !!settings?.labelCheckSecondLabelColumn;

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState("idle");

  const [firstScanned, setFirstScanned] = useState("");
  const [secondScanned, setSecondScanned] = useState("");
  const [matchedRowIndex, setMatchedRowIndex] = useState(null);
  const [matchedRecord, setMatchedRecord] = useState(null);
  const [selectionRows, setSelectionRows] = useState([]);
  const [selectedSize, setSelectedSize] = useState("");

  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    scanLockRef.current = false;
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const startScanner = async (domId, onScanOnce) => {
    if (scannerRef.current) return;

    scannerRef.current = await startQrScanner({
      elementId: domId,
      onScan: async (decodedText) => {
        if (scanLockRef.current) return;
        scanLockRef.current = true;

        const value = String(decodedText || "").trim();
        if (!value) {
          scanLockRef.current = false;
          return;
        }

        try {
          await stopScanner();
          await onScanOnce(value);
        } catch (e) {
          setStatus("");
          setError(e?.message || "Scan failed.");
          setStep("idle");
        }
      },
    });
  };

  const resetFlow = async () => {
    await stopScanner();
    setStatus("");
    setError("");
    setStep("idle");
    setFirstScanned("");
    setSecondScanned("");
    setMatchedRowIndex(null);
    setMatchedRecord(null);
    setSelectionRows([]);
    setSelectedSize("");
  };

  const loadTabs = async () => {
    setSetupErr("");
    setSetupMsg("");
    setHeaders([]);

    if (!settings?.proxyUrl) return setSetupErr("Missing Proxy URL. Go to Setup first.");
    if (!spreadsheetId) return setSetupErr("Label Check file link invalid (cannot find spreadsheet ID).");

    setTabsLoading(true);
    try {
      const list = await getSheetTabs(spreadsheetId);
      setTabs(list || []);
      if (!sheetName && list?.length) setSheetName(list[0]);
      setSetupMsg(`Loaded ${list?.length || 0} tab(s).`);
    } catch (e) {
      setSetupErr(e?.message || "Failed to load tabs.");
    } finally {
      setTabsLoading(false);
    }
  };

  const loadColumns = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl) return setSetupErr("Missing Proxy URL. Go to Setup first.");
    if (!spreadsheetId) return setSetupErr("Label Check file link invalid (cannot find spreadsheet ID).");
    if (!String(sheetName || "").trim()) return setSetupErr("Select a tab first.");

    setColumnsLoading(true);
    try {
      const cols = await getHeaders(spreadsheetId, String(sheetName || "").trim());
      setHeaders(cols || []);

      if (!firstLabelColumn && cols?.length) setFirstLabelColumn(cols[0]);
      if (!secondLabelColumn && cols?.length) setSecondLabelColumn(cols[Math.min(1, cols.length - 1)] || cols[0]);

      setSetupMsg("Columns loaded. Choose First Label and Second Label.");
    } catch (e) {
      setSetupErr(e?.message || "Failed to load columns.");
    } finally {
      setColumnsLoading(false);
    }
  };

  const savePageSetup = () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl) return setSetupErr("Missing Proxy URL. Go to Setup first.");
    if (!spreadsheetId) return setSetupErr("Label Check file link invalid.");
    if (!String(sheetName || "").trim()) return setSetupErr("Tab name is required.");
    if (!String(firstLabelColumn || "").trim()) return setSetupErr("First Label column is required.");
    if (!String(secondLabelColumn || "").trim()) return setSetupErr("Second Label column is required.");

    saveSettings({
      labelCheckFileUrl: fileUrl,
      labelCheckSpreadsheetId: spreadsheetId,
      labelCheckSheetName: String(sheetName || "").trim(),
      labelCheckFirstLabelColumn: String(firstLabelColumn || "").trim(),
      labelCheckSecondLabelColumn: String(secondLabelColumn || "").trim(),
    });

    setSetupMsg("Label Check settings saved.");
    setSetupOpen(false);
  };

  const applyResult = async (res) => {
    if (!res?.found) {
      popup("Label Not Match");
      await resetFlow();
      return;
    }

    setHeaders(res.headers || []);

    const rows = Array.isArray(res.rows) ? res.rows : [];
    if (rows.length > 1) {
      const sizes = uniqueSizes(rows);
      setSelectionRows(rows);
      setSelectedSize(sizes[0] || "");
      setStep("selectSize");
      setStatus("Choose the Size to open the matched record.");
      return;
    }

    const chosen = rows[0] || (res.rowIndex && res.record ? { rowIndex: res.rowIndex, record: res.record } : null);
    if (!chosen) {
      popup("Label Not Match");
      await resetFlow();
      return;
    }

    setMatchedRowIndex(chosen.rowIndex || null);
    setMatchedRecord(chosen.record || null);
    setStatus("Label matched.");
    setStep("result");
  };

  const begin = async () => {
    setStatus("");
    setError("");
    setFirstScanned("");
    setSecondScanned("");
    setMatchedRowIndex(null);
    setMatchedRecord(null);
    setSelectionRows([]);
    setSelectedSize("");
    setStep("scanFirst");

    await stopScanner();

    try {
      await startScanner("label-check-first-reader", async (value) => {
        setFirstScanned(value);
        setStatus("First label scanned. Now scan the second label.");
        setError("");
        setStep("scanSecond");

        await startScanner("label-check-second-reader", async (value2) => {
          setSecondScanned(value2);
          setStatus("Checking labels...");
          setError("");

          const res = await getLabelCheckRowsByTwoLabels({
            spreadsheetId: settings?.labelCheckSpreadsheetId,
            sheetName: settings?.labelCheckSheetName,
            firstLabelColumn: settings?.labelCheckFirstLabelColumn,
            secondLabelColumn: settings?.labelCheckSecondLabelColumn,
            firstLabelValue: value,
            secondLabelValue: value2,
          });

          await applyResult(res);
        });
      });
    } catch (e) {
      await resetFlow();
      setError(e?.message || "Failed to start scanner.");
    }
  };

  const confirmSelection = async () => {
    const size = String(selectedSize || "").trim().toLowerCase();
    const filtered = selectionRows.filter((row) => String(row?.size || "").trim().toLowerCase() === size);

    if (filtered.length !== 1) {
      popup(MULTI_SIZE_MSG);
      await resetFlow();
      return;
    }

    const selected = filtered[0];
    setMatchedRowIndex(selected.rowIndex || null);
    setMatchedRecord(selected.record || null);
    setSelectionRows([]);
    setStatus("Label matched.");
    setStep("result");
  };

  if (!settings?.proxyUrl) return <div className="page">Please go to Setup first.</div>;

  return (
    <div className="page">
      <h2>Label Check</h2>

      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => {
            setSetupOpen((v) => !v);
            setSetupErr("");
            setSetupMsg("");
          }}
        >
          {setupOpen ? "Close Label Check Settings" : "Label Check Settings"}
        </button>
      </div>

      {(setupOpen || !ready) && (
        <div className="card" style={{ marginTop: 10 }}>
          <h3>Label Check Setup</h3>

          {setupErr && <div className="alert alert-error">{setupErr}</div>}
          {setupMsg && <div className="alert alert-ok">{setupMsg}</div>}

          <label className="field">
            Google Sheet link
            <input
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary" onClick={loadTabs} disabled={tabsLoading || !spreadsheetId}>
              {tabsLoading ? "Loading Tabs..." : "Load Tabs"}
            </button>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="field">
              Tab name
              <select value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
                <option value="">-- Select tab --</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={loadColumns} disabled={columnsLoading || !spreadsheetId || !sheetName}>
              {columnsLoading ? "Loading Columns..." : "Load Columns"}
            </button>
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="field">
              First Label column
              <select value={firstLabelColumn} onChange={(e) => setFirstLabelColumn(e.target.value)}>
                <option value="">-- Select column --</option>
                {headers.map((h) => (
                  <option key={`first-${h}`} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Second Label column
              <select value={secondLabelColumn} onChange={(e) => setSecondLabelColumn(e.target.value)}>
                <option value="">-- Select column --</option>
                {headers.map((h) => (
                  <option key={`second-${h}`} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="primary" onClick={savePageSetup}>
            Save Label Check Setup
          </button>
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
          <p>Ready. Click Start Scanning to begin label check.</p>
          <button className="primary" onClick={begin} disabled={!ready}>
            Start Scanning
          </button>
          {!ready && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              Please complete Label Check setup above first.
            </div>
          )}
        </div>
      )}

      {step === "scanFirst" && (
        <div className="card">
          <p>
            Scan First Label QR (<strong>{settings?.labelCheckFirstLabelColumn}</strong>)
          </p>
          <div id="label-check-first-reader" />
          <button style={{ marginTop: 10 }} onClick={resetFlow}>
            Cancel
          </button>
        </div>
      )}

      {step === "scanSecond" && (
        <div className="card">
          <div style={{ marginBottom: 10 }}>
            <strong>First label:</strong> {firstScanned}
          </div>
          <p>
            Scan Second Label QR (<strong>{settings?.labelCheckSecondLabelColumn}</strong>)
          </p>
          <div id="label-check-second-reader" />
          <button style={{ marginTop: 10 }} onClick={resetFlow}>
            Cancel
          </button>
        </div>
      )}

      {step === "selectSize" && (
        <div className="card">
          <div style={{ marginBottom: 12 }}>
            <strong>First label:</strong> {firstScanned}
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Second label:</strong> {secondScanned}
          </div>

          <label className="field">
            Choose Size
            <select value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)}>
              {uniqueSizes(selectionRows).map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={confirmSelection}>
              Open Record
            </button>
            <button onClick={resetFlow}>Cancel</button>
          </div>
        </div>
      )}

      {step === "result" && matchedRecord && (
        <div className="card">
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <div>
              <strong>First label:</strong> {firstScanned}
            </div>
            <div>
              <strong>Second label:</strong> {secondScanned}
            </div>
            {matchedRowIndex ? (
              <div>
                <strong>Matched row:</strong> {matchedRowIndex}
              </div>
            ) : null}
          </div>

          <h3>Matched record</h3>
          <PrettyDetails record={matchedRecord} preferredOrder={headers} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={begin}>
              Scan another
            </button>
            <button onClick={resetFlow}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
