import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import {
  getSheetTabs,
  getPackingRecordByLabel,
  getUnpackingRecordByLabel,
  updatePackingByRow,
  updateUnpackingByRow,
} from "../api/sheetsApi";
import { loadSettings, saveSettings } from "../store/settingsStore";

// ---------------- helpers ----------------
function extractSpreadsheetId(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (!s) return "";
  // if already looks like an ID
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s) && !s.includes("http")) return s;

  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function normCompare(s) {
  return String(s || "").trim().toLowerCase();
}

function getFieldCI(record, label) {
  if (!record) return "";
  const target = normCompare(label).replace(/\s+/g, " ");
  for (const k of Object.keys(record)) {
    const kk = normCompare(k).replace(/\s+/g, " ");
    if (kk === target) return record[k];
  }
  return "";
}

function hasValue(v) {
  return String(v ?? "").trim() !== "";
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------- component ----------------
export default function PackingUnpackingManagementPage() {
  const initial = useMemo(() => loadSettings() || {}, []);

  const [settings, setSettings] = useState(initial);

  // Packing sheet settings (what sheetsApi.js expects)
  const packingSpreadsheetId = useMemo(() => {
    return (
      String(settings.packingSpreadsheetId || "").trim() ||
      extractSpreadsheetId(settings.packingUrl || settings.packingSheetUrl || "")
    );
  }, [settings]);

  const orTab = String(
    settings.packingOrSheetName ||
      settings.or_tab_label ||
      settings.orTabLabel ||
      "OR"
  ).trim();

  const graftingTab = String(
    settings.packingGraftingSheetName ||
      settings.grafting_tab_label ||
      settings.graftingTabLabel ||
      "GRAFTING"
  ).trim();

  const [packingUrl, setPackingUrl] = useState(
    settings.packingUrl || settings.packingSheetUrl || ""
  );

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Scanner
  const scannerRef = useRef(null);
  const [scannerOn, setScannerOn] = useState(false);
  const scanHandlerRef = useRef(null);

  // OR Packing state
  const [orPackState, setOrPackState] = useState({
    step: "idle", // idle | scanned1 | need2 | form | view
    code1: "",
    rowIndex: null,
    record: null,
  });

  // OR Unpacking state
  const [orUnpackState, setOrUnpackState] = useState({
    step: "idle", // idle | view | form
    code: "",
    rowIndex: null,
    record: null,
  });

  // Forms
  const [packForm, setPackForm] = useState({
    packingDate: todayISO(),
    packingQuantity: "",
    note: "",
  });

  const [unpackForm, setUnpackForm] = useState({
    unpackingDate: todayISO(),
    unpackingQuantity: "",
    note: "",
  });

  // Keep local settings in sync if other pages update them
  useEffect(() => {
    const on = () => setSettings(loadSettings() || {});
    window.addEventListener("qr_settings_changed", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("qr_settings_changed", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  const updateSettings = (patch) => {
    const next = saveSettings(patch);
    setSettings(next);
  };

  async function stopScanner() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.clear();
      }
    } catch {
      // ignore
    }
    scannerRef.current = null;
    scanHandlerRef.current = null;
    setScannerOn(false);
  }

  async function startScanner(onScan) {
    setError("");
    setMsg("");

    // Make sure only one scanner exists
    await stopScanner();

    scanHandlerRef.current = onScan;
    setScannerOn(true);

    // Delay a tick so the div exists
    setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          "packing_scanner",
          { fps: 10, qrbox: 250 },
          false
        );

        scanner.render(
          async (decodedText) => {
            const handler = scanHandlerRef.current;
            await stopScanner();
            if (handler) handler(decodedText);
          },
          () => {
            // scan failure: ignore spam
          }
        );

        scannerRef.current = scanner;
      } catch (e) {
        setError(e?.message || "Failed to start scanner.");
        setScannerOn(false);
      }
    }, 0);
  }

  useEffect(() => {
    return () => {
      // cleanup on unmount
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Tabs loading --------
  const loadTabs = async () => {
    setError("");
    setMsg("");

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet link invalid (cannot find spreadsheet ID).");

    // Persist the packing spreadsheet id + url
    updateSettings({
      packingUrl: packingUrl.trim(),
      packingSpreadsheetId: id,
    });

    setLoadingTabs(true);
    try {
      const t = await getSheetTabs(id);
      setTabs(t || []);
      setMsg("Tabs loaded.");
    } catch (e) {
      setError(e?.message || "Failed to load tabs.");
    } finally {
      setLoadingTabs(false);
    }
  };

  // -------- OR Packing flow --------
  const beginOrPacking = async () => {
    setError("");
    setMsg("");
    setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set. Paste link and load tabs first.");
    if (!orTab.trim()) return setError("OR tab name is required.");

    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null });

    await startScanner(async (scanned) => {
      const code1 = String(scanned || "").trim();
      if (!code1) return setError("Empty QR result.");

      try {
        // Ensure settings keys match sheetsApi expectations
        updateSettings({
          packingSpreadsheetId: id,
          packingOrSheetName: orTab.trim(),
          // mirror old key so you don't lose it
          or_tab_label: orTab.trim(),
        });

        const res = await getPackingRecordByLabel({ needs: "or", labelValue: code1 });
        if (!res?.found) {
          alert("Record not found in OR tab. Operation cancelled.");
          setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null });
          return;
        }
        const record = res.record || {};
        const rowIndex = res.rowIndex;

        const packDate = getFieldCI(record, "Packing Date");
        const packQty = getFieldCI(record, "Packing Quantity");



        if (hasValue(packDate) || hasValue(packQty)) {
          // already packed -> show record with Edit Packing Form
          setOrPackState({ step: "view", code1, rowIndex, record });
          return;
        }

        // not packed yet -> show record + Packing button (requires scan #2)
        setOrPackState({ step: "need2", code1, rowIndex, record });
      } catch (e) {
        setError(e?.message || "Failed to lookup record.");
        setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null });
      }
    });
  };

  const beginOrPackingScanSecond = async () => {
    setError("");
    setMsg("");

    const { code1, rowIndex, record } = orPackState;
    if (!code1 || !rowIndex) return setError("Missing first scan context. Start OR-Packing again.");

    await startScanner(async (scanned2) => {
      const code2 = String(scanned2 || "").trim();
      if (!code2) return setError("Empty QR result.");

      if (normCompare(code2) !== normCompare(code1)) {
        alert("Second QR does not match the first QR. Please re-scan the second label.");
        // stay in need2 state
        setOrPackState({ step: "need2", code1, rowIndex, record });
        return;
      }

      // proceed to packing form
      setPackForm({ packingDate: todayISO(), packingQuantity: "", note: "" });
      setOrPackState({ step: "form", code1, rowIndex, record });
    });
  };

  const saveOrPacking = async () => {
    setError("");
    setMsg("");

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set.");
    if (!orTab.trim()) return setError("OR tab name is required.");
    if (!orPackState.rowIndex) return setError("Missing rowIndex.");

    if (!packForm.packingDate.trim()) return setError("Packing Date is required.");
    if (!String(packForm.packingQuantity || "").trim()) return setError("Packing Quantity is required.");

    try {
      updateSettings({
        packingSpreadsheetId: id,
        packingOrSheetName: orTab.trim(),
        or_tab_label: orTab.trim(),
      });

      await updatePackingByRow({
        needs: "or",
        rowIndex: orPackState.rowIndex,
        packingDate: packForm.packingDate.trim(),
        packingQuantity: String(packForm.packingQuantity).trim(),
        noteAppend: String(packForm.note || "").trim(),
      });

      setMsg("Saved packing.");

      // refresh record
      const res = await getPackingRecordByLabel({ needs: "or", labelValue: orPackState.code1 });
      setOrPackState({
        step: "view",
        code1: orPackState.code1,
        rowIndex: res?.rowIndex || orPackState.rowIndex,
        record: res?.record || orPackState.record,
      });
    } catch (e) {
      setError(e?.message || "Failed to save packing.");
    }
  };

  // -------- OR Unpacking flow --------
  const beginOrUnpacking = async () => {
    setError("");
    setMsg("");
    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null });

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set. Paste link and load tabs first.");
    if (!orTab.trim()) return setError("OR tab name is required.");

    setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

    await startScanner(async (scanned) => {
      const code = String(scanned || "").trim();
      if (!code) return setError("Empty QR result.");

      try {
        updateSettings({
          packingSpreadsheetId: id,
          packingOrSheetName: orTab.trim(),
          or_tab_label: orTab.trim(),
        });

        const res = await getUnpackingRecordByLabel({ needs: "or", labelValue: code });
        if (!res?.found) {
          alert("Record not found in OR tab. Operation cancelled.");
          setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        const record = res.record || {};
        const rowIndex = res.rowIndex;

        // NEW OR-Unpacking flow requirement:
        // Unpacking is only allowed if a packing record exists.
        // We use "Packing Quantity" presence as the gate.
        const packingQty = getFieldCI(record, "Packing Quantity");
        if (!hasValue(packingQty)) {
          alert("No Packing Record");
          resetStates();
          setMode("idle");
          return;
        }

        const unpackDate = getFieldCI(record, "Unpacking Date");
        const unpackQty = getFieldCI(record, "Unpacking Quantity");

        if (hasValue(unpackDate) || hasValue(unpackQty)) {
          setOrUnpackState({ step: "view", code, rowIndex, record });
          return;
        }

        // not unpacked yet -> show Unpacking button -> go to form
        setOrUnpackState({ step: "view", code, rowIndex, record });
      } catch (e) {
        setError(e?.message || "Failed to lookup record.");
        setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
      }
    });
  };

  const goToUnpackForm = () => {
    setUnpackForm({ unpackingDate: todayISO(), unpackingQuantity: "", note: "" });
    setOrUnpackState((s) => ({ ...s, step: "form" }));
  };

  const saveOrUnpacking = async () => {
    setError("");
    setMsg("");

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set.");
    if (!orTab.trim()) return setError("OR tab name is required.");
    if (!orUnpackState.rowIndex) return setError("Missing rowIndex.");

    if (!unpackForm.unpackingDate.trim()) return setError("Unpacking Date is required.");
    if (!String(unpackForm.unpackingQuantity || "").trim()) return setError("Unpacking Quantity is required.");

    try {
      updateSettings({
        packingSpreadsheetId: id,
        packingOrSheetName: orTab.trim(),
        or_tab_label: orTab.trim(),
      });

      await updateUnpackingByRow({
        needs: "or",
        rowIndex: orUnpackState.rowIndex,
        unpackingDate: unpackForm.unpackingDate.trim(),
        unpackingQuantity: String(unpackForm.unpackingQuantity).trim(),
        noteAppend: String(unpackForm.note || "").trim(),
      });

      setMsg("Saved unpacking.");

      const res = await getUnpackingRecordByLabel({ needs: "or", labelValue: orUnpackState.code });
      setOrUnpackState({
        step: "view",
        code: orUnpackState.code,
        rowIndex: res?.rowIndex || orUnpackState.rowIndex,
        record: res?.record || orUnpackState.record,
      });
    } catch (e) {
      setError(e?.message || "Failed to save unpacking.");
    }
  };

  // -------- UI helpers --------
  const renderRecord = (record) => {
    if (!record) return null;
    // show a compact subset first; you can expand later
    const keys = Object.keys(record);
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>Record</div>
        <div style={{ maxHeight: 260, overflow: "auto", fontSize: 13 }}>
          {keys.map((k) => (
            <div key={k} style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ width: 220, fontWeight: 600 }}>{k}</div>
              <div style={{ flex: 1 }}>{String(record[k] ?? "")}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Determine if OR record already has unpack info
  const orUnpackHasData = useMemo(() => {
    const r = orUnpackState.record;
    if (!r) return false;
    return hasValue(getFieldCI(r, "Unpacking Date")) || hasValue(getFieldCI(r, "Unpacking Quantity"));
  }, [orUnpackState.record]);

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h2>Packing / Unpacking Management</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* Setup */}
      <div className="card">
        <h3>Setup (Packing / Unpacking Sheet)</h3>

        <label className="field">
          Google Sheet link
          <input
            value={packingUrl}
            onChange={(e) => setPackingUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>

        <button onClick={loadTabs} disabled={loadingTabs}>
          {loadingTabs ? "Loading..." : "Load Tabs"}
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label className="field">
            OR tab name
            <select
              value={orTab}
              onChange={(e) =>
                updateSettings({
                  // sheetsApi expected
                  packingOrSheetName: e.target.value,
                  // keep your existing key too
                  or_tab_label: e.target.value,
                })
              }
              disabled={loadingTabs || !tabs.length}
            >
              {!tabs.length && <option value={orTab}>{orTab}</option>}
              {tabs.length > 0 && tabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Grafting tab name
            <select
              value={graftingTab}
              onChange={(e) =>
                updateSettings({
                  packingGraftingSheetName: e.target.value,
                  grafting_tab_label: e.target.value,
                })
              }
              disabled={loadingTabs || !tabs.length}
            >
              {!tabs.length && <option value={graftingTab}>{graftingTab}</option>}
              {tabs.length > 0 && tabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
          This page uses your Apps Script actions: <strong>getPackingRecordByLabel</strong>, <strong>updatePackingByRow</strong>,{" "}
          <strong>getUnpackingRecordByLabel</strong>, <strong>updateUnpackingByRow</strong>.
        </div>
      </div>

      {/* Scanner container */}
      {scannerOn && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Scanner</div>
            <button onClick={stopScanner}>Cancel Scan</button>
          </div>
          <div id="packing_scanner" style={{ marginTop: 10 }} />
        </div>
      )}

      {/* Actions */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>Operations</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={beginOrPacking}>OR-Packing</button>
          <button onClick={beginOrUnpacking}>OR-Unpacking</button>

          {/* leaving placeholders for later */}
          <button disabled>Grafting-Packing</button>
          <button disabled>Grafting-Unpacking</button>
        </div>
      </div>

      {/* OR-Packing UI */}
      {(orPackState.step !== "idle") && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>OR-Packing</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              First QR: <strong>{orPackState.code1 || "-"}</strong>
            </div>

            {orPackState.step === "need2" && (
              <div style={{ marginTop: 10 }}>
                <button className="primary" onClick={beginOrPackingScanSecond}>
                  Packing (Scan 2nd QR)
                </button>
              </div>
            )}

            {orPackState.step === "view" && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="primary"
                  onClick={() => {
                    setPackForm({
                      packingDate: todayISO(),
                      packingQuantity: "",
                      note: "",
                    });
                    setOrPackState((s) => ({ ...s, step: "form" }));
                  }}
                >
                  Edit Packing Form
                </button>
                <button
                  style={{ marginLeft: 10 }}
                  onClick={() => setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null })}
                >
                  Done
                </button>
              </div>
            )}

            {orPackState.step === "form" && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4>Packing Form</h4>

                <label className="field">
                  Packing Date
                  <input
                    type="date"
                    value={packForm.packingDate}
                    onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))}
                  />
                </label>

                <label className="field">
                  Packing Quantity
                  <input
                    value={packForm.packingQuantity}
                    onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))}
                    placeholder="number"
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={packForm.note}
                    onChange={(e) => setPackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                  />
                </label>

                <div style={{ display: "flex", gap: 10 }}>
                  <button className="primary" onClick={saveOrPacking}>
                    Save Packing
                  </button>
                  <button onClick={() => setOrPackState((s) => ({ ...s, step: "view" }))}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {renderRecord(orPackState.record)}
        </div>
      )}

      {/* OR-Unpacking UI */}
      {(orUnpackState.step !== "idle") && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>OR-Unpacking</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              QR: <strong>{orUnpackState.code || "-"}</strong>
            </div>

            {orUnpackState.step === "view" && (
              <div style={{ marginTop: 10 }}>
                {orUnpackHasData ? (
                  <button className="primary" onClick={goToUnpackForm}>
                    Edit Unpacking Form
                  </button>
                ) : (
                  <button className="primary" onClick={goToUnpackForm}>
                    Unpacking
                  </button>
                )}

                <button
                  style={{ marginLeft: 10 }}
                  onClick={() => setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null })}
                >
                  Done
                </button>
              </div>
            )}

            {orUnpackState.step === "form" && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4>Unpacking Form</h4>

                <label className="field">
                  Unpacking Date
                  <input
                    type="date"
                    value={unpackForm.unpackingDate}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingDate: e.target.value }))}
                  />
                </label>

                <label className="field">
                  Unpacking Quantity
                  <input
                    value={unpackForm.unpackingQuantity}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                    placeholder="number"
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={unpackForm.note}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                  />
                </label>

                <div style={{ display: "flex", gap: 10 }}>
                  <button className="primary" onClick={saveOrUnpacking}>
                    Save Unpacking
                  </button>
                  <button onClick={() => setOrUnpackState((s) => ({ ...s, step: "view" }))}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {renderRecord(orUnpackState.record)}
        </div>
      )}
    </div>
  );
}
