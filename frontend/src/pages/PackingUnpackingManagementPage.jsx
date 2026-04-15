import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getSheetTabs,
  getPackingRecordByLabel,
  getUnpackingRecordByLabel,
  updatePackingByRow,
  updateUnpackingByRow,
  getGraftingRowsBySingleAndCombinationLabel,
  getGraftingRowsByCombinationLabel,
} from "../api/sheetsApi";
import { loadSettings, saveSettings } from "../store/settingsStore";
import { startQrScanner } from "../utils/qrScanner";

const MULTI_SIZE_MSG = "Multiple Rows Same Size";

function extractSpreadsheetId(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (!s) return "";
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

function popup(msg) {
  try {
    alert(String(msg || ""));
  } catch {
    // ignore
  }
}

function uniqueSizes(rows = []) {
  return Array.from(
    new Set(
      rows.map((row) => String(row?.size || "").trim()).filter(Boolean)
    )
  );
}

export default function PackingUnpackingManagementPage() {
  const initial = useMemo(() => loadSettings() || {}, []);
  const [settings, setSettings] = useState(initial);

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

  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);
  const [scannerOn, setScannerOn] = useState(false);

  const [orPackState, setOrPackState] = useState({
    step: "idle",
    code1: "",
    rowIndex: null,
    record: null,
    isAlreadyPacked: false,
  });

  const [orUnpackState, setOrUnpackState] = useState({
    step: "idle",
    code: "",
    rowIndex: null,
    record: null,
  });

  const [graftPackState, setGraftPackState] = useState({
    step: "idle",
    firstCode: "",
    combinationLabelScanned: "",
    selectedSize: "",
    rowIndex: null,
    record: null,
    rows: [],
  });

  const [graftUnpackState, setGraftUnpackState] = useState({
    step: "idle",
    scannedCombinationLabel: "",
    selectedSize: "",
    rowIndex: null,
    record: null,
    rows: [],
  });

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
        await scannerRef.current.stop();
      }
    } catch {
      // ignore
    }
    scannerRef.current = null;
    scanLockRef.current = false;
    setScannerOn(false);
  }

  async function startSingleScan(onScan) {
    setError("");
    setMsg("");

    await stopScanner();
    setScannerOn(true);

    try {
      scannerRef.current = await startQrScanner({
        elementId: "packing_scanner",
        onScan: async (decodedText) => {
          if (scanLockRef.current) return;
          scanLockRef.current = true;
          const value = String(decodedText || "").trim();
          if (!value) {
            scanLockRef.current = false;
            return;
          }
          await stopScanner();
          await onScan(value);
        },
      });
    } catch (e) {
      await stopScanner();
      setError(e?.message || "Failed to start scanner.");
    }
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

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

  const resetOrStates = () => {
    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
    setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
  };

  const resetGraftStates = () => {
    setGraftPackState({
      step: "idle",
      firstCode: "",
      combinationLabelScanned: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });
    setGraftUnpackState({
      step: "idle",
      scannedCombinationLabel: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });
  };

  const ensurePackingSetup = (needs = "or") => {
    const id = packingSpreadsheetId || extractSpreadsheetId(packingUrl);
    if (!id) {
      setError("Packing sheet is not set. Paste link and load tabs first.");
      return null;
    }

    const tabName = needs === "grafting" ? graftingTab : orTab;
    if (!String(tabName || "").trim()) {
      setError(needs === "grafting" ? "Grafting tab name is required." : "OR tab name is required.");
      return null;
    }

    if (needs === "grafting") {
      updateSettings({
        packingSpreadsheetId: id,
        packingGraftingSheetName: graftingTab.trim(),
        grafting_tab_label: graftingTab.trim(),
      });
    } else {
      updateSettings({
        packingSpreadsheetId: id,
        packingOrSheetName: orTab.trim(),
        or_tab_label: orTab.trim(),
      });
    }

    return id;
  };

  // ---------- OR Packing ----------
  const beginOrPacking = async () => {
    setError("");
    setMsg("");
    resetGraftStates();
    setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });

    const id = ensurePackingSetup("or");
    if (!id) return;

    setOrPackState({ step: "scan1", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });

    await startSingleScan(async (scanned) => {
      const code1 = String(scanned || "").trim();
      if (!code1) return setError("Empty QR result.");

      try {
        const res = await getPackingRecordByLabel({ needs: "or", labelValue: code1 });

        if (!res?.found) {
          popup("Record not found in OR tab. Operation cancelled.");
          setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });
          return;
        }

        const record = res.record || {};
        const rowIndex = res.rowIndex;
        const isAlreadyPacked = hasValue(getFieldCI(record, "Packing Date")) || hasValue(getFieldCI(record, "Packing Quantity"));

        setOrPackState({
          step: isAlreadyPacked ? "view" : "need2",
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

    await startSingleScan(async (scanned2) => {
      const code2 = String(scanned2 || "").trim();
      if (!code2) return setError("Empty QR result.");

      if (normCompare(code2) !== normCompare(code1)) {
        const again = window.confirm(
          "Second QR does NOT match the first QR.\n\nOK = Re-scan the second label\nCancel = Cancel operation (back to idle)"
        );

        if (again) {
          await beginOrPackingRequireSecondScan();
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

    const id = ensurePackingSetup("or");
    if (!id) return;
    if (!orPackState.rowIndex) return setError("Missing rowIndex.");
    if (!packForm.packingDate.trim()) return setError("Packing Date is required.");
    if (!String(packForm.binNumber || "").trim()) return setError("Bin # is required.");
    if (!String(packForm.packingQuantity || "").trim()) return setError("Packing Quantity is required.");

    const pProc = parseNumberStrict(getFieldCI(orPackState.record, "Processing Quantity"));
    if (!pProc.ok) return setError('Missing or invalid "Processing Quantity" in the record. Cannot validate packing quantity.');

    const pPack = parseNumberStrict(packForm.packingQuantity);
    if (!pPack.ok) return setError('Invalid "Packing Quantity". Please enter a numeric value.');
    if (pPack.value > pProc.value) {
      popup(`Packing Quantity (${pPack.value}) cannot be greater than Processing Quantity (${pProc.value}).`);
      return;
    }

    try {
      setSavingPack(true);
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

  // ---------- OR Unpacking ----------
  const beginOrUnpacking = async () => {
    setError("");
    setMsg("");
    resetGraftStates();
    setOrPackState({ step: "idle", code1: "", rowIndex: null, record: null, isAlreadyPacked: false });

    const id = ensurePackingSetup("or");
    if (!id) return;

    setOrUnpackState({ step: "scan", code: "", rowIndex: null, record: null });

    await startSingleScan(async (scanned) => {
      const code = String(scanned || "").trim();
      if (!code) return setError("Empty QR result.");

      try {
        const res = await getUnpackingRecordByLabel({ needs: "or", labelValue: code });

        if (!res?.found) {
          popup("Record not found in OR tab. Operation cancelled.");
          setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        const record = res.record || {};
        if (!hasValue(getFieldCI(record, "Packing Quantity"))) {
          popup("No Packing Record");
          setOrUnpackState({ step: "idle", code: "", rowIndex: null, record: null });
          return;
        }

        setOrUnpackState({ step: "view", code, rowIndex: res.rowIndex, record });
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

    const id = ensurePackingSetup("or");
    if (!id) return;
    if (!orUnpackState.rowIndex) return setError("Missing rowIndex.");
    if (!unpackForm.unpackingDate.trim()) return setError("Unpacking Date is required.");
    if (!String(unpackForm.unpackingQuantity || "").trim()) return setError("Unpacking Quantity is required.");

    const pPack = parseNumberStrict(getFieldCI(orUnpackState.record, "Packing Quantity"));
    if (!pPack.ok) return setError('Missing or invalid "Packing Quantity" in the record. Cannot validate unpacking quantity.');

    const pUnpack = parseNumberStrict(unpackForm.unpackingQuantity);
    if (!pUnpack.ok) return setError('Invalid "Unpacking Quantity". Please enter a numeric value.');
    if (pUnpack.value > pPack.value) {
      popup(`Unpacking Quantity (${pUnpack.value}) cannot be greater than Packing Quantity (${pPack.value}).`);
      return;
    }

    try {
      setSavingUnpack(true);
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

  // ---------- Grafting shared ----------
  const resolveSingleRowBySize = (rows, selectedSize) => {
    const size = String(selectedSize || "").trim().toLowerCase();
    const filtered = (rows || []).filter((row) => String(row?.size || "").trim().toLowerCase() === size);
    if (filtered.length !== 1) return null;
    return filtered[0];
  };

  // ---------- Grafting Packing ----------
  const beginGraftingPacking = async () => {
    setError("");
    setMsg("");
    resetOrStates();
    setGraftUnpackState({
      step: "idle",
      scannedCombinationLabel: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });

    const id = ensurePackingSetup("grafting");
    if (!id) return;

    const baseState = {
      step: "scanFirst",
      firstCode: "",
      combinationLabelScanned: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    };
    setGraftPackState(baseState);

    await startSingleScan(async (firstScanned) => {
      const firstCode = String(firstScanned || "").trim();
      if (!firstCode) return setError("Empty QR result.");

      setGraftPackState({ ...baseState, firstCode, step: "scanCombinationLabel" });

      await startSingleScan(async (comboScanned) => {
        const combinationLabelScanned = String(comboScanned || "").trim();
        if (!combinationLabelScanned) return setError("Empty QR result.");

        try {
          const res = await getGraftingRowsBySingleAndCombinationLabel({
            firstLabelValue: firstCode,
            combinationLabelValue: combinationLabelScanned,
          });

          if (!res?.found) {
            popup("Label Not Match");
            setGraftPackState(baseState);
            return;
          }

          const rows = Array.isArray(res.rows) ? res.rows : [];
          if (rows.length === 1) {
            const row = rows[0];
            const record = row?.record || null;
            const isAlreadyPacked =
              hasValue(getFieldCI(record, "Packing Date")) || hasValue(getFieldCI(record, "Packing Quantity"));

            setGraftPackState({
              step: "matched",
              firstCode,
              combinationLabelScanned,
              selectedSize: String(row?.size || ""),
              rowIndex: row?.rowIndex || null,
              record,
              rows,
              isAlreadyPacked,
            });
            return;
          }

          const sizes = uniqueSizes(rows);
          setGraftPackState({
            step: "selectSize",
            firstCode,
            combinationLabelScanned,
            selectedSize: sizes[0] || "",
            rowIndex: null,
            record: null,
            rows,
            isAlreadyPacked: false,
          });
        } catch (e) {
          setError(e?.message || "Failed to lookup grafting packing record.");
          setGraftPackState(baseState);
        }
      });
    });
  };

  const confirmGraftPackSize = () => {
    const row = resolveSingleRowBySize(graftPackState.rows, graftPackState.selectedSize);
    if (!row) {
      popup(MULTI_SIZE_MSG);
      setGraftPackState({
        step: "idle",
        firstCode: "",
        combinationLabelScanned: "",
        selectedSize: "",
        rowIndex: null,
        record: null,
        rows: [],
      });
      return;
    }

    const record = row.record || null;
    const isAlreadyPacked =
      hasValue(getFieldCI(record, "Packing Date")) || hasValue(getFieldCI(record, "Packing Quantity"));

    setGraftPackState((s) => ({
      ...s,
      step: "matched",
      rowIndex: row.rowIndex || null,
      record,
      isAlreadyPacked,
    }));
  };

  const goToGraftPackForm = () => {
    setPackForm({ packingDate: todayISO(), binNumber: "", packingQuantity: "", note: "" });
    setGraftPackState((s) => ({ ...s, step: "form" }));
  };

  const saveGraftingPacking = async () => {
    setError("");
    setMsg("");

    const id = ensurePackingSetup("grafting");
    if (!id) return;
    if (!graftPackState.rowIndex) return setError("Missing rowIndex.");
    if (!packForm.packingDate.trim()) return setError("Packing Date is required.");
    if (!String(packForm.binNumber || "").trim()) return setError("Bin # is required.");
    if (!String(packForm.packingQuantity || "").trim()) return setError("Packing Quantity is required.");

    const pProc = parseNumberStrict(getFieldCI(graftPackState.record, "Processing Quantity"));
    if (!pProc.ok) return setError('Missing or invalid "Processing Quantity" in the record. Cannot validate packing quantity.');

    const pPack = parseNumberStrict(packForm.packingQuantity);
    if (!pPack.ok) return setError('Invalid "Packing Quantity". Please enter a numeric value.');
    if (pPack.value > pProc.value) {
      popup(`Packing Quantity (${pPack.value}) cannot be greater than Processing Quantity (${pProc.value}).`);
      return;
    }

    try {
      setSavingPack(true);
      await updatePackingByRow({
        needs: "grafting",
        rowIndex: graftPackState.rowIndex,
        packingDate: packForm.packingDate.trim(),
        binNumber: String(packForm.binNumber || "").trim(),
        packingQuantity: String(packForm.packingQuantity).trim(),
        noteAppend: String(packForm.note || "").trim(),
      });

      setMsg("Saved grafting packing.");
      const res = await getGraftingRowsByCombinationLabel({
        combinationLabelValue: graftPackState.combinationLabelScanned,
      });
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const refreshed =
        rows.find((row) => Number(row?.rowIndex) === Number(graftPackState.rowIndex)) || null;

      setGraftPackState((s) => ({
        ...s,
        step: "matched",
        record: refreshed?.record || s.record,
        rows,
        isAlreadyPacked: true,
      }));
    } catch (e) {
      setError(e?.message || "Failed to save grafting packing.");
    } finally {
      setSavingPack(false);
    }
  };

  // ---------- Grafting Unpacking ----------
  const beginGraftingUnpacking = async () => {
    setError("");
    setMsg("");
    resetOrStates();
    setGraftPackState({
      step: "idle",
      firstCode: "",
      combinationLabelScanned: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });

    const id = ensurePackingSetup("grafting");
    if (!id) return;

    const baseState = {
      step: "scanCombinationLabel",
      scannedCombinationLabel: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    };
    setGraftUnpackState(baseState);

    await startSingleScan(async (scanned) => {
      const scannedCombinationLabel = String(scanned || "").trim();
      if (!scannedCombinationLabel) return setError("Empty QR result.");

      try {
        const res = await getGraftingRowsByCombinationLabel({ combinationLabelValue: scannedCombinationLabel });
        if (!res?.found) {
          popup("Record not found in Grafting tab. Operation cancelled.");
          setGraftUnpackState({ ...baseState, step: "idle" });
          return;
        }

        const rows = Array.isArray(res.rows) ? res.rows : [];
        if (rows.length === 1) {
          const record = rows[0]?.record || null;
          if (!hasValue(getFieldCI(record, "Packing Quantity"))) {
            popup("No Packing Record");
            setGraftUnpackState({ ...baseState, step: "idle" });
            return;
          }

          setGraftUnpackState({
            step: "matched",
            scannedCombinationLabel,
            selectedSize: String(rows[0]?.size || ""),
            rowIndex: rows[0]?.rowIndex || null,
            record,
            rows,
          });
          return;
        }

        const sizes = uniqueSizes(rows);
        setGraftUnpackState({
          step: "selectSize",
          scannedCombinationLabel,
          selectedSize: sizes[0] || "",
          rowIndex: null,
          record: null,
          rows,
        });
      } catch (e) {
        setError(e?.message || "Failed to lookup grafting unpacking record.");
        setGraftUnpackState({ ...baseState, step: "idle" });
      }
    });
  };

  const confirmGraftUnpackSize = () => {
    const row = resolveSingleRowBySize(graftUnpackState.rows, graftUnpackState.selectedSize);
    if (!row) {
      popup(MULTI_SIZE_MSG);
      setGraftUnpackState({
        step: "idle",
        scannedCombinationLabel: "",
        selectedSize: "",
        rowIndex: null,
        record: null,
        rows: [],
      });
      return;
    }

    const record = row.record || null;
    if (!hasValue(getFieldCI(record, "Packing Quantity"))) {
      popup("No Packing Record");
      setGraftUnpackState({
        step: "idle",
        scannedCombinationLabel: "",
        selectedSize: "",
        rowIndex: null,
        record: null,
        rows: [],
      });
      return;
    }

    setGraftUnpackState((s) => ({
      ...s,
      step: "matched",
      rowIndex: row.rowIndex || null,
      record,
    }));
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

    const id = ensurePackingSetup("grafting");
    if (!id) return;
    if (!graftUnpackState.rowIndex) return setError("Missing rowIndex.");
    if (!unpackForm.unpackingDate.trim()) return setError("Unpacking Date is required.");
    if (!String(unpackForm.unpackingQuantity || "").trim()) return setError("Unpacking Quantity is required.");

    const pPack = parseNumberStrict(getFieldCI(graftUnpackState.record, "Packing Quantity"));
    if (!pPack.ok) return setError('Missing or invalid "Packing Quantity" in the record. Cannot validate unpacking quantity.');

    const pUnpack = parseNumberStrict(unpackForm.unpackingQuantity);
    if (!pUnpack.ok) return setError('Invalid "Unpacking Quantity". Please enter a numeric value.');
    if (pUnpack.value > pPack.value) {
      popup(`Unpacking Quantity (${pUnpack.value}) cannot be greater than Packing Quantity (${pPack.value}).`);
      return;
    }

    try {
      setSavingUnpack(true);
      await updateUnpackingByRow({
        needs: "grafting",
        rowIndex: graftUnpackState.rowIndex,
        unpackingDate: unpackForm.unpackingDate.trim(),
        unpackingQuantity: String(unpackForm.unpackingQuantity).trim(),
        noteAppend: String(unpackForm.note || "").trim(),
      });

      setMsg("Saved grafting unpacking.");
      const res = await getGraftingRowsByCombinationLabel({
        combinationLabelValue: graftUnpackState.scannedCombinationLabel,
      });
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const refreshed =
        rows.find((row) => Number(row?.rowIndex) === Number(graftUnpackState.rowIndex)) || null;

      setGraftUnpackState((s) => ({
        ...s,
        step: "matched",
        record: refreshed?.record || s.record,
        rows,
      }));
    } catch (e) {
      setError(e?.message || "Failed to save grafting unpacking.");
    } finally {
      setSavingUnpack(false);
    }
  };

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

  const closeGraftPack = () =>
    setGraftPackState({
      step: "idle",
      firstCode: "",
      combinationLabelScanned: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });

  const closeGraftUnpack = () =>
    setGraftUnpackState({
      step: "idle",
      scannedCombinationLabel: "",
      selectedSize: "",
      rowIndex: null,
      record: null,
      rows: [],
    });

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h2>Packing / Unpacking Management</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

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
              {!tabs.length && <option value="">-- Select OR tab --</option>}
              {tabs.map((t) => (
                <option key={`or-${t}`} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            GRAFTING tab name
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
              {!tabs.length && <option value="">-- Select GRAFTING tab --</option>}
              {tabs.map((t) => (
                <option key={`graft-${t}`} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Load tabs, then choose OR and GRAFTING tabs. Settings save immediately when you change the dropdowns.
        </div>
      </div>

      <div className="card">
        <h3>Choose operation</h3>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="primary" onClick={beginOrPacking} disabled={savingPack || savingUnpack}>
            OR-Packing
          </button>
          <button className="primary" onClick={beginOrUnpacking} disabled={savingPack || savingUnpack}>
            OR-Unpacking
          </button>
          <button className="primary" onClick={beginGraftingPacking} disabled={savingPack || savingUnpack}>
            Grafting-Packing
          </button>
          <button className="primary" onClick={beginGraftingUnpacking} disabled={savingPack || savingUnpack}>
            Grafting-Unpacking
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div id="packing_scanner" style={{ display: scannerOn ? "block" : "none" }} />
        </div>
      </div>

      {(orPackState.step !== "idle" || orPackState.record) && (
        <div className="card">
          <h3>OR-Packing</h3>

          {orPackState.step === "scan1" && <div className="alert">Scan the OR label QR.</div>}

          {orPackState.step === "need2" && (
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
                <input type="date" value={packForm.packingDate} onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))} disabled={savingPack} />
              </label>
              <label className="field">
                Bin #
                <input value={packForm.binNumber} onChange={(e) => setPackForm((p) => ({ ...p, binNumber: e.target.value }))} placeholder="bin number" disabled={savingPack} />
              </label>
              <label className="field">
                Packing Quantity
                <input value={packForm.packingQuantity} onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))} placeholder="number" disabled={savingPack} />
              </label>
              <label className="field">
                Note (append)
                <textarea value={packForm.note} onChange={(e) => setPackForm((p) => ({ ...p, note: e.target.value }))} rows={3} disabled={savingPack} />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={saveOrPacking} disabled={savingPack}>
                  {savingPack ? "Saving..." : "Save Packing"}
                </button>
                <button onClick={() => setOrPackState((s) => ({ ...s, step: "view" }))} disabled={savingPack}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Validation: Packing Quantity cannot exceed Processing Quantity.</div>
            </div>
          )}

          {renderRecord(orPackState.record)}
        </div>
      )}

      {(orUnpackState.step !== "idle" || orUnpackState.record) && (
        <div className="card">
          <h3>OR-Unpacking</h3>

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
                <input type="date" value={unpackForm.unpackingDate} onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingDate: e.target.value }))} disabled={savingUnpack} />
              </label>
              <label className="field">
                Unpacking Quantity
                <input value={unpackForm.unpackingQuantity} onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingQuantity: e.target.value }))} placeholder="number" disabled={savingUnpack} />
              </label>
              <label className="field">
                Note (append)
                <textarea value={unpackForm.note} onChange={(e) => setUnpackForm((p) => ({ ...p, note: e.target.value }))} rows={3} disabled={savingUnpack} />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={saveOrUnpacking} disabled={savingUnpack}>
                  {savingUnpack ? "Saving..." : "Save Unpacking"}
                </button>
                <button onClick={() => setOrUnpackState((s) => ({ ...s, step: "view" }))} disabled={savingUnpack}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Validation: Unpacking Quantity cannot exceed Packing Quantity.</div>
            </div>
          )}

          {renderRecord(orUnpackState.record)}
        </div>
      )}

      {(graftPackState.step !== "idle" || graftPackState.record) && (
        <div className="card">
          <h3>Grafting-Packing</h3>

          {graftPackState.step === "scanFirst" && <div className="alert">Scan the Scion White Code or Rootstock White Code QR.</div>}
          {graftPackState.step === "scanCombinationLabel" && <div className="alert">Scan the Combination Label QR.</div>}

          {graftPackState.step === "selectSize" && (
            <div className="card" style={{ marginTop: 12 }}>
              <label className="field">
                Choose Size
                <select
                  value={graftPackState.selectedSize}
                  onChange={(e) => setGraftPackState((s) => ({ ...s, selectedSize: e.target.value }))}
                >
                  {uniqueSizes(graftPackState.rows).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={confirmGraftPackSize}>
                  Open Record
                </button>
                <button onClick={closeGraftPack}>Cancel</button>
              </div>
            </div>
          )}

          {graftPackState.step === "matched" && (
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {graftPackState.isAlreadyPacked ? (
                <button className="primary" onClick={goToGraftPackForm} disabled={savingPack || savingUnpack}>
                  Edit Packing Form
                </button>
              ) : (
                <button className="primary" onClick={goToGraftPackForm} disabled={savingPack || savingUnpack}>
                  Packing
                </button>
              )}
              <button onClick={closeGraftPack} disabled={savingPack || savingUnpack}>
                Done
              </button>
            </div>
          )}

          {graftPackState.step === "form" && (
            <div className="card" style={{ marginTop: 12 }}>
              <h4>Packing Form</h4>
              <label className="field">
                Bin #
                <input value={packForm.binNumber} onChange={(e) => setPackForm((p) => ({ ...p, binNumber: e.target.value }))} placeholder="Bin # (required)" disabled={savingPack} />
              </label>
              <label className="field">
                Packing Date
                <input type="date" value={packForm.packingDate} onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))} disabled={savingPack} />
              </label>
              <label className="field">
                Packing Quantity
                <input value={packForm.packingQuantity} onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))} placeholder="number" disabled={savingPack} />
              </label>
              <label className="field">
                Note (append)
                <textarea value={packForm.note} onChange={(e) => setPackForm((p) => ({ ...p, note: e.target.value }))} rows={3} disabled={savingPack} />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={saveGraftingPacking} disabled={savingPack}>
                  {savingPack ? "Saving..." : "Save Packing"}
                </button>
                <button onClick={() => setGraftPackState((s) => ({ ...s, step: "matched" }))} disabled={savingPack}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Validation: Packing Quantity cannot exceed Processing Quantity.</div>
            </div>
          )}

          {renderRecord(graftPackState.record)}
        </div>
      )}

      {(graftUnpackState.step !== "idle" || graftUnpackState.record) && (
        <div className="card">
          <h3>Grafting-Unpacking</h3>

          {graftUnpackState.step === "scanCombinationLabel" && <div className="alert">Scan the Combination Label QR.</div>}

          {graftUnpackState.step === "selectSize" && (
            <div className="card" style={{ marginTop: 12 }}>
              <label className="field">
                Choose Size
                <select
                  value={graftUnpackState.selectedSize}
                  onChange={(e) => setGraftUnpackState((s) => ({ ...s, selectedSize: e.target.value }))}
                >
                  {uniqueSizes(graftUnpackState.rows).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={confirmGraftUnpackSize}>
                  Open Record
                </button>
                <button onClick={closeGraftUnpack}>Cancel</button>
              </div>
            </div>
          )}

          {graftUnpackState.step === "matched" && (
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
              <button onClick={closeGraftUnpack} disabled={savingUnpack}>
                Done
              </button>
            </div>
          )}

          {graftUnpackState.step === "form" && (
            <div className="card" style={{ marginTop: 12 }}>
              <h4>Unpacking Form</h4>
              <label className="field">
                Unpacking Date
                <input type="date" value={unpackForm.unpackingDate} onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingDate: e.target.value }))} disabled={savingUnpack} />
              </label>
              <label className="field">
                Unpacking Quantity
                <input value={unpackForm.unpackingQuantity} onChange={(e) => setUnpackForm((p) => ({ ...p, unpackingQuantity: e.target.value }))} placeholder="number" disabled={savingUnpack} />
              </label>
              <label className="field">
                Note (append)
                <textarea value={unpackForm.note} onChange={(e) => setUnpackForm((p) => ({ ...p, note: e.target.value }))} rows={3} disabled={savingUnpack} />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="primary" onClick={saveGraftingUnpacking} disabled={savingUnpack}>
                  {savingUnpack ? "Saving..." : "Save Unpacking"}
                </button>
                <button onClick={() => setGraftUnpackState((s) => ({ ...s, step: "matched" }))} disabled={savingUnpack}>
                  Cancel
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Validation: Unpacking Quantity cannot exceed Packing Quantity.</div>
            </div>
          )}

          {renderRecord(graftUnpackState.record)}
        </div>
      )}
    </div>
  );
}
