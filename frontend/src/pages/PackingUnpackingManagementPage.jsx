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

function normalizeHeader(s) {
  return normCompare(s).replace(/\s+/g, " ").trim();
}

// case-insensitive field getter (also normalizes whitespace)
function getFieldCI(record, label) {
  if (!record) return "";
  const target = normalizeHeader(label);
  for (const k of Object.keys(record)) {
    if (normalizeHeader(k) === target) return record[k];
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

function parseNumberStrict(v) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: false, value: 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, value: 0 };
  return { ok: true, value: n };
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

  const orTab = String(settings.packingOrSheetName || settings.or_tab_label || settings.orTabLabel || "OR").trim();

  const graftingTab = String(
    settings.packingGraftingSheetName || settings.grafting_tab_label || settings.graftingTabLabel || "GRAFTING"
  ).trim();

  const [packingUrl, setPackingUrl] = useState(settings.packingUrl || settings.packingSheetUrl || "");

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [savingPack, setSavingPack] = useState(false);
  const [savingUnpack, setSavingUnpack] = useState(false);

  // Scanner
  const scannerRef = useRef(null);
  const [scannerOn, setScannerOn] = useState(false);
  const scanHandlerRef = useRef(null);

  // OR Packing state
  // step meanings:
  // idle: nothing active
  // needAction: scanned #1 + record shown; show "Packing" OR show "Edit Packing Form" depending on packed state
  // need2: waiting for 2nd scan to match
  // form: packing form open
  // view: record view after save or after existing packed record
  const [orPackState, setOrPackState] = useState({
    step: "idle",
    code1: "",
    rowIndex: null,
    record: null,
    isAlreadyPacked: false,
  });

  // OR Unpacking state
  // step meanings:
  // idle: nothing active
  // view: show record + action button (Unpacking or Edit Unpacking Form)
  // form: unpacking form open
  const [orUnpackState, setOrUnpackState] = useState({
    step: "idle",
    code: "",
    rowIndex: null,
    record: null,
  });

  // Grafting Packing state
  // step meanings:
  // idle: nothing active
  // scion: waiting / scanned scion
  // rootstock: waiting for rootstock scan
  // needAction: record shown, not packed yet (requires combination label scan)
  // needCombo: waiting for combination label scan
  // form: packing form open
  // view: record view after save or if already packed
  const [graftPackState, setGraftPackState] = useState({
    step: "idle",
    scionCode: "",
    rootstockCode: "",
    comboCode: "",
    rowIndex: null,
    record: null,
    isAlreadyPacked: false,
  });

  // Grafting Unpacking state
  // step meanings:
  // idle: nothing active
  // view: show record + action button (Unpacking or Edit Unpacking Form)
  // form: unpacking form open
  const [graftUnpackState, setGraftUnpackState] = useState({
    step: "idle",
    code: "",
    rowIndex: null,
    record: null,
  });

  // Forms (shared)
  const [packForm, setPackForm] = useState({
    packingDate: todayISO(),
    binNumber: "",
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
        const scanner = new Html5QrcodeScanner("packing_scanner", { fps: 10, qrbox: 250 }, false);

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
    setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });
    setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set. Paste link and load tabs first.");
    if (!orTab.trim()) return setError("OR tab name is required.");

    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });

    await startScanner(async (scanned) => {
      const code1 = String(scanned || "").trim();
      if (!code1) return setError("Empty QR result.");

      try {
        updateSettings({
          packingSpreadsheetId: id,
          packingOrSheetName: orTab.trim(),
          or_tab_label: orTab.trim(),
        });

        const res = await getPackingRecordByLabel({ needs: "or", labelValue: code1 });

        if (!res?.found) {
          alert("Record not found in OR tab. Operation cancelled.");
          setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
          return;
        }

        const record = res.record || {};
        const rowIndex = res.rowIndex;

        const packDate = getFieldCI(record, "Packing Date");
        const packQty = getFieldCI(record, "Packing Quantity");
        const isAlreadyPacked = hasValue(packDate) || hasValue(packQty);

        setOrPackState({
          step: isAlreadyPacked ? "view" : "needAction",
          code1,
          rowIndex,
          record,
          isAlreadyPacked,
        });
      } catch (e) {
        setError(e?.message || "Failed to lookup record.");
        setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
      }
    });
  };

  const beginOrPackingRequireSecondScan = async () => {
    setError("");
    setMsg("");

    const { code1, rowIndex, record } = orPackState;
    if (!code1 || !rowIndex) return setError("Missing first scan context. Start OR-Packing again.");

    setOrPackState((s) => ({ ...s, step: "need2" }));

    await startScanner(async (scanned2) => {
      const code2 = String(scanned2 || "").trim();
      if (!code2) return setError("Empty QR result.");

      if (normCompare(code2) !== normCompare(code1)) {
        const again = window.confirm(
          "Second QR does NOT match the first QR.\n\nOK = Re-scan the second label\nCancel = Cancel operation (back to idle)"
        );

        if (again) {
          setOrPackState({ step: "need2", code1, rowIndex, record, isAlreadyPacked: false });
          beginOrPackingRequireSecondScan();
          return;
        }

        setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
        return;
      }

      setPackForm({ packingDate: todayISO(), binNumber: "", packingQuantity: "", note: "" });
      setOrPackState({ step: "form", code1, rowIndex, record, isAlreadyPacked: false });
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
    if (!String(packForm.binNumber || "").trim()) return setError("Bin # is required.");
    if (!String(packForm.packingQuantity || "").trim()) return setError("Packing Quantity is required.");

    const processingRaw = getFieldCI(orPackState.record, "Processing Quantity");
    const pProc = parseNumberStrict(processingRaw);
    if (!pProc.ok) {
      return setError('Missing or invalid "Processing Quantity" in the record. Cannot validate packing quantity.');
    }

    const pPack = parseNumberStrict(packForm.packingQuantity);
    if (!pPack.ok) {
      return setError('Invalid "Packing Quantity". Please enter a numeric value.');
    }

    if (pPack.value > pProc.value) {
      alert(`Packing Quantity (${pPack.value}) cannot be greater than Processing Quantity (${pProc.value}).`);
      return;
    }

    try {
      setSavingPack(true);

      updateSettings({
        packingSpreadsheetId: id,
        packingOrSheetName: orTab.trim(),
        or_tab_label: orTab.trim(),
      });

      await updatePackingByRow({
        needs: "or",
        rowIndex: orPackState.rowIndex,
        packingDate: packForm.packingDate.trim(),
        binNumber: String(packForm.binNumber || "").trim(),
        packingQuantity: String(packForm.packingQuantity).trim(),
        noteAppend: String(packForm.note || "").trim(),
      });

      setMsg("Saved packing.");

      const res = await getPackingRecordByLabel({ needs: "or", labelValue: orPackState.code1 });
      setOrPackState({
        step: "view",
        code1: orPackState.code1,
        rowIndex: res?.rowIndex || orPackState.rowIndex,
        record: res?.record || orPackState.record,
        isAlreadyPacked: true,
      });
    } catch (e) {
      setError(e?.message || "Failed to save packing.");
    } finally {
      setSavingPack(false);
    }
  };

  // -------- OR Unpacking flow --------
  const beginOrUnpacking = async () => {
    setError("");
    setMsg("");
    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
    setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });
    setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

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

        const packingQty = getFieldCI(record, "Packing Quantity");
        if (!hasValue(packingQty)) {
          alert("No Packing Record");
          setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        setOrUnpackState({ step: "view", code, rowIndex, record });
      } catch (e) {
        setError(e?.message || "Failed to lookup record.");
        setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
      }
    });
  };

  const orUnpackHasData = useMemo(() => {
    const r = orUnpackState.record;
    if (!r) return false;
    return hasValue(getFieldCI(r, "Unpacking Date")) || hasValue(getFieldCI(r, "Unpacking Quantity"));
  }, [orUnpackState.record]);

  const goToOrUnpackForm = () => {
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

    const packingRaw = getFieldCI(orUnpackState.record, "Packing Quantity");
    const pPack = parseNumberStrict(packingRaw);
    if (!pPack.ok) {
      return setError('Missing or invalid "Packing Quantity" in the record. Cannot validate unpacking quantity.');
    }

    const pUnpack = parseNumberStrict(unpackForm.unpackingQuantity);
    if (!pUnpack.ok) {
      return setError('Invalid "Unpacking Quantity". Please enter a numeric value.');
    }

    if (pUnpack.value > pPack.value) {
      alert(`Unpacking Quantity (${pUnpack.value}) cannot be greater than Packing Quantity (${pPack.value}).`);
      return;
    }

    try {
      setSavingUnpack(true);

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
    } finally {
      setSavingUnpack(false);
    }
  };

  
// -------- Grafting Packing flow --------
const beginGraftingPacking = async () => {
  setError("");
  setMsg("");

  // reset other flows
  setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
  setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
  setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

  const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
  if (!id) return setError("Packing sheet is not set. Paste link and load tabs first.");
  if (!graftingTab.trim()) return setError("Grafting tab name is required.");

  // initial state
  setGraftPackState({
    step: "scion",
    scionCode: "",
    rootstockCode: "",
    comboCode: "",
    rowIndex: null,
    record: null,
    isAlreadyPacked: false,
  });

  await startScanner(async (scannedScion) => {
    const scionCode = String(scannedScion || "").trim();
    if (!scionCode) return setError("Empty QR result.");

    try {
      updateSettings({
        packingSpreadsheetId: id,
        packingGraftingSheetName: graftingTab.trim(),
        grafting_tab_label: graftingTab.trim(),
      });

      const res1 = await getPackingRecordByLabel({ needs: "grafting", labelValue: scionCode });
      if (!res1?.found) {
        alert("Scion label not found in Grafting tab. Operation cancelled.");
        setGraftPackState({
          step: "idle",
          scionCode: "",
          rootstockCode: "",
          comboCode: "",
          rowIndex: null,
          record: null,
          isAlreadyPacked: false,
        });
        return;
      }

      const record1 = res1.record || {};
      const rowIndex1 = res1.rowIndex;

      setGraftPackState({
        step: "rootstock",
        scionCode,
        rootstockCode: "",
        comboCode: "",
        rowIndex: rowIndex1,
        record: record1,
        isAlreadyPacked: false,
      });

      const scanRootstock = async () => {
        await startScanner(async (scannedRoot) => {
          const rootstockCode = String(scannedRoot || "").trim();
          if (!rootstockCode) return setError("Empty QR result.");

          try {
            const res2 = await getPackingRecordByLabel({ needs: "grafting", labelValue: rootstockCode });
            if (!res2?.found) {
              alert("Rootstock label not found in Grafting tab. Operation cancelled.");
              setGraftPackState({
                step: "idle",
                scionCode: "",
                rootstockCode: "",
                comboCode: "",
                rowIndex: null,
                record: null,
                isAlreadyPacked: false,
              });
              return;
            }

            const rowIndex2 = res2.rowIndex;

            if (rowIndex2 !== rowIndex1) {
              const again = window.confirm(
                "Scion label and Rootstock label are NOT on the same row.\n\nOK = Re-scan Rootstock label\nCancel = Cancel operation (back to idle)"
              );

              if (again) {
                setGraftPackState({
                  step: "rootstock",
                  scionCode,
                  rootstockCode: "",
                  comboCode: "",
                  rowIndex: rowIndex1,
                  record: record1,
                  isAlreadyPacked: false,
                });
                await scanRootstock();
                return;
              }

              setGraftPackState({
                step: "idle",
                scionCode: "",
                rootstockCode: "",
                comboCode: "",
                rowIndex: null,
                record: null,
                isAlreadyPacked: false,
              });
              return;
            }

            const record = record1;

            const packDate = getFieldCI(record, "Packing Date");
            const packQty = getFieldCI(record, "Packing Quantity");
            const isAlreadyPacked = hasValue(packDate) || hasValue(packQty);

            setGraftPackState({
              step: isAlreadyPacked ? "view" : "needAction",
              scionCode,
              rootstockCode,
              comboCode: "",
              rowIndex: rowIndex1,
              record,
              isAlreadyPacked,
            });
          } catch (e) {
            setError(e?.message || "Failed to lookup rootstock record.");
            setGraftPackState({
              step: "idle",
              scionCode: "",
              rootstockCode: "",
              comboCode: "",
              rowIndex: null,
              record: null,
              isAlreadyPacked: false,
            });
          }
        });
      };

      await scanRootstock();
    } catch (e) {
      setError(e?.message || "Failed to lookup scion record.");
      setGraftPackState({
        step: "idle",
        scionCode: "",
        rootstockCode: "",
        comboCode: "",
        rowIndex: null,
        record: null,
        isAlreadyPacked: false,
      });
    }
  });
};

const beginGraftingPackingRequireCombo = async () => {
    setError("");
    setMsg("");

    const { scionCode, rootstockCode, rowIndex, record } = graftPackState;
    if (!scionCode || !rootstockCode || !rowIndex || !record) return setError("Missing scion/rootstock context. Start Grafting-Packing again.");

    setGraftPackState((s) => ({ ...s, step: "needCombo" }));

    await startScanner(async (scannedCombo) => {
      const comboCode = String(scannedCombo || "").trim();
      if (!comboCode) return setError("Empty QR result.");

      try {
        const res3 = await getPackingRecordByLabel({ needs: "grafting", labelValue: comboCode });
        if (!res3?.found) {
          const again = window.confirm(
            "Combination label not found on Grafting tab.\n\nOK = Re-scan combination label\nCancel = Cancel operation (back to idle)"
          );
          if (again) {
            beginGraftingPackingRequireCombo();
            return;
          }
          setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });
          return;
        }

        if (res3.rowIndex !== rowIndex) {
          const again = window.confirm(
            "Combination label does NOT match the scion/rootstock row.\n\nOK = Re-scan combination label\nCancel = Cancel operation (back to idle)"
          );
          if (again) {
            beginGraftingPackingRequireCombo();
            return;
          }
          setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });
          return;
        }

        setPackForm({ packingDate: todayISO(), binNumber: "", packingQuantity: "", note: "" });
        setGraftPackState({ step: "form", scionCode, rootstockCode, comboCode, rowIndex, record, isAlreadyPacked: false });
      } catch (e) {
        setError(e?.message || "Failed to verify combination label.");
        setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });
      }
    });
  };

  const saveGraftingPacking = async () => {
    setError("");
    setMsg("");

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set.");
    if (!graftingTab.trim()) return setError("Grafting tab name is required.");
    if (!graftPackState.rowIndex) return setError("Missing rowIndex.");

    if (!packForm.packingDate.trim()) return setError("Packing Date is required.");
    if (!String(packForm.binNumber || "").trim()) return setError("Bin # is required.");
    if (!String(packForm.packingQuantity || "").trim()) return setError("Packing Quantity is required.");

    const processingRaw = getFieldCI(graftPackState.record, "Processing Quantity");
    const pProc = parseNumberStrict(processingRaw);
    if (!pProc.ok) {
      return setError('Missing or invalid "Processing Quantity" in the record. Cannot validate packing quantity.');
    }

    const pPack = parseNumberStrict(packForm.packingQuantity);
    if (!pPack.ok) {
      return setError('Invalid "Packing Quantity". Please enter a numeric value.');
    }

    if (pPack.value > pProc.value) {
      alert(`Packing Quantity (${pPack.value}) cannot be greater than Processing Quantity (${pProc.value}).`);
      return;
    }

    try {
      setSavingPack(true);

      updateSettings({
        packingSpreadsheetId: id,
        packingGraftingSheetName: graftingTab.trim(),
        grafting_tab_label: graftingTab.trim(),
      });

      await updatePackingByRow({
        needs: "grafting",
        rowIndex: graftPackState.rowIndex,
        packingDate: packForm.packingDate.trim(),
        binNumber: String(packForm.binNumber || "").trim(),
        packingQuantity: String(packForm.packingQuantity).trim(),
        noteAppend: String(packForm.note || "").trim(),
      });

      setMsg("Saved grafting packing.");

      // Reload using best known label (combo preferred)
      const lookupLabel = graftPackState.comboCode || graftPackState.scionCode || graftPackState.rootstockCode;
      const res = await getPackingRecordByLabel({ needs: "grafting", labelValue: lookupLabel });

      setGraftPackState((s) => ({
        ...s,
        step: "view",
        rowIndex: res?.rowIndex || s.rowIndex,
        record: res?.record || s.record,
        isAlreadyPacked: true,
      }));
    } catch (e) {
      setError(e?.message || "Failed to save grafting packing.");
    } finally {
      setSavingPack(false);
    }
  };

  // -------- Grafting Unpacking flow --------
  const beginGraftingUnpacking = async () => {
    setError("");
    setMsg("");
    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
    setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
    setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false });

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set. Paste link and load tabs first.");
    if (!graftingTab.trim()) return setError("Grafting tab name is required.");

    setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

    await startScanner(async (scanned) => {
      const code = String(scanned || "").trim();
      if (!code) return setError("Empty QR result.");

      try {
        updateSettings({
          packingSpreadsheetId: id,
          packingGraftingSheetName: graftingTab.trim(),
          grafting_tab_label: graftingTab.trim(),
        });

        const res = await getUnpackingRecordByLabel({ needs: "grafting", labelValue: code });

        if (!res?.found) {
          alert("No Packing Record");
          setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        const record = res.record || {};
        const rowIndex = res.rowIndex;

        const packingQty = getFieldCI(record, "Packing Quantity");
        if (!hasValue(packingQty)) {
          alert("No Packing Record");
          setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        setGraftUnpackState({ step: "view", code, rowIndex, record });
      } catch (e) {
        setError(e?.message || "Failed to lookup record.");
        setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
      }
    });
  };

  const graftUnpackHasData = useMemo(() => {
    const r = graftUnpackState.record;
    if (!r) return false;
    return hasValue(getFieldCI(r, "Unpacking Date")) || hasValue(getFieldCI(r, "Unpacking Quantity"));
  }, [graftUnpackState.record]);

  const goToGraftUnpackForm = () => {
    setUnpackForm({ unpackingDate: todayISO(), unpackingQuantity: "", note: "" });
    setGraftUnpackState((s) => ({ ...s, step: "form" }));
  };

  const saveGraftingUnpacking = async () => {
    setError("");
    setMsg("");

    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) return setError("Packing sheet is not set.");
    if (!graftingTab.trim()) return setError("Grafting tab name is required.");
    if (!graftUnpackState.rowIndex) return setError("Missing rowIndex.");

    if (!unpackForm.unpackingDate.trim()) return setError("Unpacking Date is required.");
    if (!String(unpackForm.unpackingQuantity || "").trim()) return setError("Unpacking Quantity is required.");

    const packingRaw = getFieldCI(graftUnpackState.record, "Packing Quantity");
    const pPack = parseNumberStrict(packingRaw);
    if (!pPack.ok) {
      return setError('Missing or invalid "Packing Quantity" in the record. Cannot validate unpacking quantity.');
    }

    const pUnpack = parseNumberStrict(unpackForm.unpackingQuantity);
    if (!pUnpack.ok) {
      return setError('Invalid "Unpacking Quantity". Please enter a numeric value.');
    }

    if (pUnpack.value > pPack.value) {
      alert(`Unpacking Quantity (${pUnpack.value}) cannot be greater than Packing Quantity (${pPack.value}).`);
      return;
    }

    try {
      setSavingUnpack(true);

      updateSettings({
        packingSpreadsheetId: id,
        packingGraftingSheetName: graftingTab.trim(),
        grafting_tab_label: graftingTab.trim(),
      });

      await updateUnpackingByRow({
        needs: "grafting",
        rowIndex: graftUnpackState.rowIndex,
        unpackingDate: unpackForm.unpackingDate.trim(),
        unpackingQuantity: String(unpackForm.unpackingQuantity).trim(),
        noteAppend: String(unpackForm.note || "").trim(),
      });

      setMsg("Saved grafting unpacking.");

      const res = await getUnpackingRecordByLabel({ needs: "grafting", labelValue: graftUnpackState.code });
      setGraftUnpackState({
        step: "view",
        code: graftUnpackState.code,
        rowIndex: res?.rowIndex || graftUnpackState.rowIndex,
        record: res?.record || graftUnpackState.record,
      });
    } catch (e) {
      setError(e?.message || "Failed to save grafting unpacking.");
    } finally {
      setSavingUnpack(false);
    }
  };

  // -------- UI helpers --------
  const renderRecord = (record) => {
    if (!record) return null;
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
                  packingOrSheetName: e.target.value,
                  or_tab_label: e.target.value,
                })
              }
              disabled={loadingTabs || !tabs.length}
            >
              {!tabs.length && <option value={orTab}>{orTab}</option>}
              {tabs.length > 0 &&
                tabs.map((t) => (
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
              {tabs.length > 0 &&
                tabs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
          This page uses your Apps Script actions: <strong>getPackingRecordByLabel</strong>,{" "}
          <strong>updatePackingByRow</strong>, <strong>getUnpackingRecordByLabel</strong>,{" "}
          <strong>updateUnpackingByRow</strong>.
        </div>
      </div>

      {/* Scanner container */}
      {scannerOn && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Scanner</div>
            <button onClick={stopScanner} disabled={savingPack || savingUnpack}>
              Cancel Scan
            </button>
          </div>
          <div id="packing_scanner" style={{ marginTop: 10 }} />
        </div>
      )}

      {/* Actions */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>Operations</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={beginOrPacking} disabled={savingPack || savingUnpack}>
            OR-Packing
          </button>
          <button onClick={beginOrUnpacking} disabled={savingPack || savingUnpack}>
            OR-Unpacking
          </button>

          <button onClick={beginGraftingPacking} disabled={savingPack || savingUnpack}>
            Grafting-Packing
          </button>
          <button onClick={beginGraftingUnpacking} disabled={savingPack || savingUnpack}>
            Grafting-Unpacking
          </button>
        </div>
      </div>

      {/* OR-Packing UI */}
      {orPackState.step !== "idle" && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>OR-Packing</h3>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              First QR: <strong>{orPackState.code1 || "-"}</strong>
            </div>

            {orPackState.step === "needAction" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={beginOrPackingRequireSecondScan} disabled={savingPack || savingUnpack}>
                  Packing
                </button>
                <button
                  onClick={() => setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false })}
                  disabled={savingPack || savingUnpack}
                >
                  Cancel
                </button>
              </div>
            )}

            {orPackState.step === "need2" && (
              <div style={{ marginTop: 10 }}>
                <div className="alert">
                  Scan the <strong>second label QR</strong> (must match the first QR).
                </div>
              </div>
            )}

            {orPackState.step === "view" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="primary"
                  onClick={() => {
                    setPackForm({ packingDate: todayISO(), binNumber: "", packingQuantity: "", note: "" });
                    setOrPackState((s) => ({ ...s, step: "form" }));
                  }}
                  disabled={savingPack || savingUnpack}
                >
                  Edit Packing Form
                </button>

                <button
                  onClick={() => setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false })}
                  disabled={savingPack || savingUnpack}
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
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Bin #
                  <input
                    value={packForm.binNumber}
                    onChange={(e) => setPackForm((p) => ({ ...p, binNumber: e.target.value }))}
                    placeholder="bin number"
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Bin #
                  <input
                    value={packForm.binNumber}
                    onChange={(e) => setPackForm((p) => ({ ...p, binNumber: e.target.value }))}
                    placeholder="bin number"
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Packing Quantity
                  <input
                    value={packForm.packingQuantity}
                    onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))}
                    placeholder="number"
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={packForm.note}
                    onChange={(e) => setPackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                    disabled={savingPack}
                  />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="primary" onClick={saveOrPacking} disabled={savingPack}>
                    {savingPack ? "Saving..." : "Save Packing"}
                  </button>
                  <button onClick={() => setOrPackState((s) => ({ ...s, step: "view" }))} disabled={savingPack}>
                    Cancel
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Validation: Packing Quantity cannot exceed Processing Quantity.
                </div>
              </div>
            )}
          </div>

          {renderRecord(orPackState.record)}
        </div>
      )}

      {/* OR-Unpacking UI */}
      {orUnpackState.step !== "idle" && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>OR-Unpacking</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              QR: <strong>{orUnpackState.code || "-"}</strong>
            </div>

            {orUnpackState.step === "view" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {orUnpackHasData ? (
                  <button className="primary" onClick={goToOrUnpackForm} disabled={savingUnpack}>
                    Edit Unpacking Form
                  </button>
                ) : (
                  <button className="primary" onClick={goToOrUnpackForm} disabled={savingUnpack}>
                    Unpacking
                  </button>
                )}

                <button onClick={() => setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null })} disabled={savingUnpack}>
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
                    disabled={savingUnpack}
                  />
                </label>

                <label className="field">
                  Unpacking Quantity
                  <input
                    value={unpackForm.unpackingQuantity}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                    placeholder="number"
                    disabled={savingUnpack}
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={unpackForm.note}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                    disabled={savingUnpack}
                  />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="primary" onClick={saveOrUnpacking} disabled={savingUnpack}>
                    {savingUnpack ? "Saving..." : "Save Unpacking"}
                  </button>
                  <button onClick={() => setOrUnpackState((s) => ({ ...s, step: "view" }))} disabled={savingUnpack}>
                    Cancel
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Validation: Unpacking Quantity cannot exceed Packing Quantity.
                </div>
              </div>
            )}
          </div>

          {renderRecord(orUnpackState.record)}
        </div>
      )}

      {/* Grafting-Packing UI */}
      {graftPackState.step !== "idle" && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>Grafting-Packing</h3>

            <div style={{ fontSize: 13, opacity: 0.85, display: "grid", gap: 4 }}>
              <div>
                Scion QR: <strong>{graftPackState.scionCode || "-"}</strong>
              </div>
              <div>
                Rootstock QR: <strong>{graftPackState.rootstockCode || "-"}</strong>
              </div>
              {graftPackState.comboCode ? (
                <div>
                  Combination QR: <strong>{graftPackState.comboCode}</strong>
                </div>
              ) : null}
            </div>

            {graftPackState.step === "scion" && (
              <div style={{ marginTop: 10 }} className="alert">
                Scan the <strong>Scion label QR</strong>.
              </div>
            )}

            {graftPackState.step === "rootstock" && (
              <div style={{ marginTop: 10 }} className="alert">
                Scan the <strong>Rootstock label QR</strong> (must be on the same row as the scion).
              </div>
            )}

            {graftPackState.step === "needAction" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={beginGraftingPackingRequireCombo} disabled={savingPack || savingUnpack}>
                  Packing
                </button>
                <button
                  onClick={() =>
                    setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false })
                  }
                  disabled={savingPack || savingUnpack}
                >
                  Cancel
                </button>
              </div>
            )}

            {graftPackState.step === "needCombo" && (
              <div style={{ marginTop: 10 }} className="alert">
                Scan the <strong>Combination label QR</strong> (must match scion/rootstock row).
              </div>
            )}

            {graftPackState.step === "view" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="primary"
                  onClick={() => {
                    setPackForm({ packingDate: todayISO(), binNumber: "", packingQuantity: "", note: "" });
                    setGraftPackState((s) => ({ ...s, step: "form" }));
                  }}
                  disabled={savingPack || savingUnpack}
                >
                  Edit Packing Form
                </button>

                <button
                  onClick={() =>
                    setGraftPackState({ step: "idle", scionCode: "", rootstockCode: "", comboCode: "", rowIndex: null, record: null, isAlreadyPacked: false })
                  }
                  disabled={savingPack || savingUnpack}
                >
                  Done
                </button>
              </div>
            )}

            {graftPackState.step === "form" && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4>Packing Form</h4>

                <label className="field">
                  Packing Date
                  <input
                    type="date"
                    value={packForm.packingDate}
                    onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))}
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Packing Quantity
                  <input
                    value={packForm.packingQuantity}
                    onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))}
                    placeholder="number"
                    disabled={savingPack}
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={packForm.note}
                    onChange={(e) => setPackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                    disabled={savingPack}
                  />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="primary" onClick={saveGraftingPacking} disabled={savingPack}>
                    {savingPack ? "Saving..." : "Save Packing"}
                  </button>
                  <button onClick={() => setGraftPackState((s) => ({ ...s, step: "view" }))} disabled={savingPack}>
                    Cancel
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Validation: Packing Quantity cannot exceed Processing Quantity.
                </div>
              </div>
            )}
          </div>

          {renderRecord(graftPackState.record)}
        </div>
      )}

      {/* Grafting-Unpacking UI */}
      {graftUnpackState.step !== "idle" && (
        <div style={{ marginTop: 12 }}>
          <div className="card">
            <h3>Grafting-Unpacking</h3>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Combination QR: <strong>{graftUnpackState.code || "-"}</strong>
            </div>

            {graftUnpackState.step === "view" && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {graftUnpackHasData ? (
                  <button className="primary" onClick={goToGraftUnpackForm} disabled={savingUnpack}>
                    Edit Unpacking Form
                  </button>
                ) : (
                  <button className="primary" onClick={goToGraftUnpackForm} disabled={savingUnpack}>
                    Unpacking
                  </button>
                )}

                <button onClick={() => setGraftUnpackState({ step: "idle", code: "", rowIndex: null, record: null })} disabled={savingUnpack}>
                  Done
                </button>
              </div>
            )}

            {graftUnpackState.step === "form" && (
              <div className="card" style={{ marginTop: 12 }}>
                <h4>Unpacking Form</h4>

                <label className="field">
                  Unpacking Date
                  <input
                    type="date"
                    value={unpackForm.unpackingDate}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingDate: e.target.value }))}
                    disabled={savingUnpack}
                  />
                </label>

                <label className="field">
                  Unpacking Quantity
                  <input
                    value={unpackForm.unpackingQuantity}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                    placeholder="number"
                    disabled={savingUnpack}
                  />
                </label>

                <label className="field">
                  Note (append)
                  <textarea
                    value={unpackForm.note}
                    onChange={(e) => setUnpackForm((p) => ({ ...p, note: e.target.value }))}
                    rows={3}
                    disabled={savingUnpack}
                  />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="primary" onClick={saveGraftingUnpacking} disabled={savingUnpack}>
                    {savingUnpack ? "Saving..." : "Save Unpacking"}
                  </button>
                  <button onClick={() => setGraftUnpackState((s) => ({ ...s, step: "view" }))} disabled={savingUnpack}>
                    Cancel
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  Validation: Unpacking Quantity cannot exceed Packing Quantity.
                </div>
              </div>
            )}
          </div>

          {renderRecord(graftUnpackState.record)}
        </div>
      )}
    </div>
  );
}
