import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { useT } from "../i18n";
import { loadSettings, saveSettings } from "../store/settingsStore";
import {
  getSheetTabs,
  getPackingRecordByLabel,
  updatePackingByRow,
  getUnpackingRecordByLabel,
  updateUnpackingByRow,
} from "../api/sheetsApi";

// ----------------------------
// helpers
// ----------------------------
function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function pickCI(obj, ...names) {
  if (!obj) return "";
  const keys = Object.keys(obj);
  for (const n of names) {
    const target = String(n ?? "").trim().toLowerCase();
    const k = keys.find((kk) => String(kk ?? "").trim().toLowerCase() === target);
    if (k) return obj[k];
  }
  return "";
}

function extractSpreadsheetId(value) {
  const s = String(value || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && m[1]) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return "";
}

function normalizeCode(v) {
  // OR labels are numeric-like; keep as trimmed string and compare case-insensitively anyway
  return String(v || "").trim().toLowerCase();
}

function todayISO() {
  // yyyy-mm-dd (works with <input type="date" />)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ----------------------------
// component
// ----------------------------
export default function PackingUnpackingManagementPage() {
  const t = useT();

  const [settings, setSettings] = useState(() => loadSettings() || {});
  const [packingSheetUrl, setPackingSheetUrl] = useState(settings?.packingSheetUrl || "");
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Flow state
  const [mode, setMode] = useState("idle"); // idle | orPack_scan1 | orPack_ready | orPack_scan2 | orPack_form | orUnpack_scan | orUnpack_ready | orUnpack_form
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // Record
  const [rowIndex, setRowIndex] = useState(null);
  const [record, setRecord] = useState(null);
  const [firstQr, setFirstQr] = useState("");

  // Forms
  const [packingDate, setPackingDate] = useState(todayISO());
  const [packingQty, setPackingQty] = useState("");
  const [unpackingDate, setUnpackingDate] = useState(todayISO());
  const [unpackingQty, setUnpackingQty] = useState("");
  const [note, setNote] = useState("");

  const [isSaving, setIsSaving] = useState(false);

  // Scanner refs
  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);
  const lastScanRef = useRef({ value: "", ts: 0 });

  // Scan protection (match BinStoragePage approach)
  const SCAN_LOCK_MS = 800;
  const DEDUPE_SAME_VALUE_MS = 2500;

  useEffect(() => {
    // Keep settings in sync if other pages update it
    const next = loadSettings() || {};
    setSettings(next);
    setPackingSheetUrl(next?.packingSheetUrl || "");
  }, []);

  const packingReady = useMemo(() => {
    const s = settings || {};
    return !!(s.packingSpreadsheetId && s.packingOrSheetName);
  }, [settings]);

  const popup = (msg) => {
    try {
      alert(String(msg || ""));
    } catch {}
  };

  const updateSettings = (partial) => {
    const next = saveSettings(partial);
    setSettings(next);
    return next;
  };

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

        const now = Date.now();
        if (lastScanRef.current.value === v && now - lastScanRef.current.ts < DEDUPE_SAME_VALUE_MS) {
          return;
        }

        if (scanLockRef.current) return;
        scanLockRef.current = true;
        lastScanRef.current = { value: v, ts: now };

        try {
          await Promise.resolve(onScan(v));
        } finally {
          setTimeout(() => {
            scanLockRef.current = false;
          }, SCAN_LOCK_MS);
        }
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const resetAll = async () => {
    await stopScanner();
    setMode("idle");
    setStatus("");
    setError("");
    setRowIndex(null);
    setRecord(null);
    setFirstQr("");
    setPackingDate(todayISO());
    setPackingQty("");
    setUnpackingDate(todayISO());
    setUnpackingQty("");
    setNote("");
  };

  // ----------------------------
  // Tabs / settings
  // ----------------------------
  const loadTabs = async () => {
    setError("");
    setStatus("");

    const spreadsheetId = extractSpreadsheetId(packingSheetUrl);
    if (!spreadsheetId) {
      setError("Invalid spreadsheet link / ID.");
      return;
    }

    setLoadingTabs(true);
    try {
      const res = await getSheetTabs({ spreadsheetId });
      const list = res?.tabs || [];
      setTabs(list);

      // Persist spreadsheetId + url
      updateSettings({
        packingSheetUrl,
        packingSpreadsheetId: spreadsheetId,
      });

      if (!list.length) {
        setError("No tabs found in this spreadsheet.");
      } else {
        setStatus("Tabs loaded. Please select OR tab and Grafting tab.");
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoadingTabs(false);
    }
  };

  // ----------------------------
  // OR-Packing flow
  // ----------------------------
  const beginOrPacking = async () => {
    if (isSaving) return;
    setError("");
    setStatus("");

    const s = loadSettings() || {};
    if (!s?.packingSpreadsheetId || !s?.packingOrSheetName) {
      setError("Packing settings missing. Paste the Packing spreadsheet link, load tabs, and select OR tab first.");
      return;
    }

    await resetAll();
    setMode("orPack_scan1");
    setStatus("OR-Packing: Scan the FIRST label QR (White Code).");

    setTimeout(() => {
      startScanner("or-pack-scan-1", async (qr) => {
        await stopScanner();

        const code = String(qr || "").trim();
        setFirstQr(code);

        setStatus("Looking up record...");
        setError("");

        try {
          const r = await getPackingRecordByLabel({ needs: "or", labelValue: code });
          if (!r?.found) {
            popup("Record not found. Operation cancelled.");
            await resetAll();
            return;
          }

          setRowIndex(r.rowIndex);
          setRecord(r.record || {});

          const existingPackDate = pickCI(r.record, "Packing Date");
          const existingPackQty = pickCI(r.record, "Packing Quantity");

          if (!isBlank(existingPackDate) || !isBlank(existingPackQty)) {
            setMode("orPack_ready");
            setStatus("Already packed. Use 'Edit Packing Form' if you want to update.");
            return;
          }

          setMode("orPack_ready");
          setStatus("Record found. Click 'Packing' to scan the SECOND label.");
        } catch (e) {
          setError(e?.message || String(e));
          setMode("idle");
        }
      });
    }, 200);
  };

  const beginOrPackingScanSecond = async () => {
    if (isSaving) return;

    if (!rowIndex || !record) {
      setError("Missing record context. Please restart OR-Packing.");
      return;
    }

    await stopScanner();
    setMode("orPack_scan2");
    setStatus("OR-Packing: Scan the SECOND label QR. It must match the first White Code.");

    setTimeout(() => {
      startScanner("or-pack-scan-2", async (qr2) => {
        await stopScanner();

        const a = normalizeCode(firstQr);
        const b = normalizeCode(qr2);

        if (!a || !b || a !== b) {
          popup("Mismatch: second QR does not match the first White Code. Please rescan the second label.");
          // stay in scan2
          setMode("orPack_scan2");
          setStatus("OR-Packing: Scan the SECOND label again (must match first).");
          setTimeout(() => {
            startScanner("or-pack-scan-2", async (v) => {
              // This re-entry is handled by the same function; user can just scan again.
            });
          }, 200);
          return;
        }

        // Matched => go to packing form
        setMode("orPack_form");
        setStatus("Enter Packing Date / Quantity and Save.");
      });
    }, 200);
  };

  const saveOrPacking = async () => {
    if (isSaving) return;
    setError("");
    setStatus("");

    if (!rowIndex) {
      setError("Missing rowIndex. Please restart OR-Packing.");
      return;
    }

    if (isBlank(packingDate) || isBlank(packingQty)) {
      setError("Packing Date and Packing Quantity are required.");
      return;
    }

    setIsSaving(true);
    try {
      await updatePackingByRow({
        needs: "or",
        rowIndex,
        packingDate,
        packingQuantity: packingQty,
        noteAppend: note,
      });

      popup("Saved.");
      await resetAll();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setIsSaving(false);
    }
  };

  // ----------------------------
  // OR-Unpacking flow (1 QR only)
  // ----------------------------
  const beginOrUnpacking = async () => {
    if (isSaving) return;
    setError("");
    setStatus("");

    const s = loadSettings() || {};
    if (!s?.packingSpreadsheetId || !s?.packingOrSheetName) {
      setError("Packing settings missing. Paste the Packing spreadsheet link, load tabs, and select OR tab first.");
      return;
    }

    await resetAll();
    setMode("orUnpack_scan");
    setStatus("OR-Unpacking: Scan the label QR (White Code).");

    setTimeout(() => {
      startScanner("or-unpack-scan-1", async (qr) => {
        await stopScanner();

        const code = String(qr || "").trim();
        setFirstQr(code);

        setStatus("Looking up record...");
        setError("");

        try {
          const r = await getUnpackingRecordByLabel({ needs: "or", labelValue: code });
          if (!r?.found) {
            popup("Record not found. Operation cancelled.");
            await resetAll();
            return;
          }

          setRowIndex(r.rowIndex);
          setRecord(r.record || {});

          const existingUnpackDate = pickCI(r.record, "Unpacking Date");
          const existingUnpackQty = pickCI(r.record, "Unpacking Quantity");

          setMode("orUnpack_ready");

          if (!isBlank(existingUnpackDate) || !isBlank(existingUnpackQty)) {
            setStatus("Already unpacked. Use 'Edit Unpacking Form' if you want to update.");
          } else {
            setStatus("Record found. Click 'Unpacking' to enter Unpacking info.");
          }
        } catch (e) {
          setError(e?.message || String(e));
          setMode("idle");
        }
      });
    }, 200);
  };

  const goToUnpackingForm = async () => {
    if (isSaving) return;
    if (!rowIndex || !record) {
      setError("Missing record context. Please restart OR-Unpacking.");
      return;
    }
    await stopScanner();
    setMode("orUnpack_form");
    setStatus("Enter Unpacking Date / Quantity and Save.");
  };

  const saveOrUnpacking = async () => {
    if (isSaving) return;
    setError("");
    setStatus("");

    if (!rowIndex) {
      setError("Missing rowIndex. Please restart OR-Unpacking.");
      return;
    }

    if (isBlank(unpackingDate) || isBlank(unpackingQty)) {
      setError("Unpacking Date and Unpacking Quantity are required.");
      return;
    }

    setIsSaving(true);
    try {
      await updateUnpackingByRow({
        needs: "or",
        rowIndex,
        unpackingDate,
        unpackingQuantity: unpackingQty,
        noteAppend: note,
      });

      popup("Saved.");
      await resetAll();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setIsSaving(false);
    }
  };

  // ----------------------------
  // UI bits
  // ----------------------------
  const renderRecordSummary = () => {
    if (!record) return null;

    const wc = pickCI(record, "White Code");
    const packDate = pickCI(record, "Packing Date");
    const packQty = pickCI(record, "Packing Quantity");
    const unpackDate = pickCI(record, "Unpacking Date");
    const unpackQty = pickCI(record, "Unpacking Quantity");

    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Record</div>
        <div style={{ fontSize: 14, lineHeight: "20px" }}>
          <div>
            <b>White Code:</b> {String(wc || firstQr || "")}
          </div>
          <div>
            <b>Packing Date:</b> {String(packDate || "")}
          </div>
          <div>
            <b>Packing Qty:</b> {String(packQty || "")}
          </div>
          <div>
            <b>Unpacking Date:</b> {String(unpackDate || "")}
          </div>
          <div>
            <b>Unpacking Qty:</b> {String(unpackQty || "")}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <h2>{t("Packing / Unpacking")}</h2>

      {/* Settings */}
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("Packing Settings")}</div>

        <label style={{ display: "block", marginBottom: 6 }}>{t("Packing Spreadsheet Link")}</label>
        <input
          value={packingSheetUrl}
          onChange={(e) => setPackingSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          style={{ width: "100%", marginBottom: 10 }}
        />

        <button onClick={loadTabs} disabled={loadingTabs}>
          {loadingTabs ? t("Loading...") : t("Load Tabs")}
        </button>

        {tabs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ display: "block", marginBottom: 6 }}>{t("OR Tab")}</label>
              <select
                value={settings?.packingOrSheetName || ""}
                onChange={(e) => updateSettings({ packingOrSheetName: e.target.value })}
                disabled={loadingTabs || !tabs.length}
                style={{ width: "100%" }}
              >
                <option value="">{t("Select tab")}</option>
                {tabs.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: 6 }}>{t("Grafting Tab")}</label>
              <select
                value={settings?.packingGraftingSheetName || ""}
                onChange={(e) => updateSettings({ packingGraftingSheetName: e.target.value })}
                disabled={loadingTabs || !tabs.length}
                style={{ width: "100%" }}
              >
                <option value="">{t("Select tab")}</option>
                {tabs.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {!packingReady && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
            Note: OR scan requires <b>Packing Spreadsheet</b> + <b>OR Tab</b> selected.
          </div>
        )}
      </div>

      {/* Status / errors */}
      {!!status && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Status:</b> {status}
        </div>
      )}
      {!!error && (
        <div className="card" style={{ marginTop: 12, border: "1px solid #c33" }}>
          <b>Error:</b> {error}
        </div>
      )}

      {/* Actions */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={beginOrPacking} disabled={!packingReady || isSaving}>
            OR-Packing
          </button>

          <button onClick={beginOrUnpacking} disabled={!packingReady || isSaving}>
            OR-Unpacking
          </button>

          <button disabled style={{ opacity: 0.6 }}>
            Grafting-Packing (later)
          </button>
          <button disabled style={{ opacity: 0.6 }}>
            Grafting-Unpacking (later)
          </button>

          <button onClick={resetAll} disabled={isSaving}>
            Cancel / Reset
          </button>
        </div>
      </div>

      {/* OR-Packing Scan UI */}
      {mode === "orPack_scan1" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>OR-Packing: Scan 1st label</div>
          <div id="or-pack-scan-1" />
        </div>
      )}

      {mode === "orPack_scan2" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>OR-Packing: Scan 2nd label (must match first)</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <b>First QR:</b> {firstQr}
          </div>
          <div id="or-pack-scan-2" />
        </div>
      )}

      {/* OR-Unpacking Scan UI */}
      {mode === "orUnpack_scan" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>OR-Unpacking: Scan label</div>
          <div id="or-unpack-scan-1" />
        </div>
      )}

      {/* Record display */}
      {(mode === "orPack_ready" || mode === "orUnpack_ready") && (
        <>
          {renderRecordSummary()}

          <div className="card" style={{ marginTop: 12 }}>
            {mode === "orPack_ready" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => setMode("orPack_form")} disabled={isSaving}>
                  Edit Packing Form
                </button>
                <button onClick={beginOrPackingScanSecond} disabled={isSaving}>
                  Packing
                </button>
              </div>
            )}

            {mode === "orUnpack_ready" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={goToUnpackingForm} disabled={isSaving}>
                  Edit Unpacking Form
                </button>
                <button onClick={goToUnpackingForm} disabled={isSaving}>
                  Unpacking
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Packing Form */}
      {mode === "orPack_form" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Packing Form (OR)</div>

          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <div>
              <label>Packing Date</label>
              <input type="date" value={packingDate} onChange={(e) => setPackingDate(e.target.value)} />
            </div>

            <div>
              <label>Packing Quantity</label>
              <input value={packingQty} onChange={(e) => setPackingQty(e.target.value)} placeholder="number" />
            </div>

            <div>
              <label>Note (append)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="optional" />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveOrPacking} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button onClick={resetAll} disabled={isSaving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unpacking Form */}
      {mode === "orUnpack_form" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Unpacking Form (OR)</div>

          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <div>
              <label>Unpacking Date</label>
              <input type="date" value={unpackingDate} onChange={(e) => setUnpackingDate(e.target.value)} />
            </div>

            <div>
              <label>Unpacking Quantity</label>
              <input value={unpackingQty} onChange={(e) => setUnpackingQty(e.target.value)} placeholder="number" />
            </div>

            <div>
              <label>Note (append)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="optional" />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveOrUnpacking} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button onClick={resetAll} disabled={isSaving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
