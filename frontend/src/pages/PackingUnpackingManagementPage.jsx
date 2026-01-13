import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadSettings, saveSettings } from "../store/settingsStore";
import {
  getSheetTabs,
  getPackingRecordByLabel,
  updatePackingByRow,
  getUnpackingRecordByLabel,
  updateUnpackingByRow,
} from "../api/sheetsApi";

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function pickCI(obj, ...names) {
  if (!obj) return "";
  const keys = Object.keys(obj);
  for (const n of names) {
    const target = String(n).trim().toLowerCase();
    const k = keys.find((kk) => String(kk).trim().toLowerCase() === target);
    if (k) return obj[k];
  }
  return "";
}

export default function PackingUnpackingManagementPage() {
  const { t, i18n } = useTranslation();

  // tri-language helper used across your app
  const tt = (en, es, vi) => {
    const lang = String(i18n?.language || "en").toLowerCase();
    if (lang.startsWith("es")) return es ?? en;
    if (lang.startsWith("vi")) return vi ?? en;
    return en;
  };

  const [settings, setSettings] = useState(loadSettings());
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Modes
  const MODES = useMemo(
    () => [
      { id: "or-pack", label: "OR-Packing" },
      { id: "or-unpack", label: "OR-Unpacking" },
      { id: "grafting-pack", label: "Grafting-Packing" },
      { id: "grafting-unpack", label: "Grafting-Unpacking" },
    ],
    []
  );

  const [activeMode, setActiveMode] = useState(null);

  // OR-Unpacking state
  const [opStatus, setOpStatus] = useState("");
  const [opError, setOpError] = useState("");
  const [scannedLabel, setScannedLabel] = useState("");
  const [record, setRecord] = useState(null);
  const [recordRow, setRecordRow] = useState(null);
  const [matchedColumn, setMatchedColumn] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });

  // OR-Packing (2-step scan)
  const [orPackStep, setOrPackStep] = useState("idle"); // idle | scan1 | scan2 | ready
  const [firstLabel, setFirstLabel] = useState("");
  const [firstRow, setFirstRow] = useState(null);
  const [firstMatchedColumn, setFirstMatchedColumn] = useState(null);
  const [showPackForm, setShowPackForm] = useState(false);
  const [packForm, setPackForm] = useState({ packingDate: "", packingQuantity: "", noteAppend: "" });

  // Scanner
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);

  const normalizeCodeForCompare = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    // Numeric -> strip leading zeros for comparison
    if (/^\d+$/.test(s)) {
      const stripped = s.replace(/^0+/, "");
      return (stripped === "" ? "0" : stripped).toLowerCase();
    }
    return s.toLowerCase();
  };

  // Load tabs (OR + GRAFTING) from Spreadsheet ID
  useEffect(() => {
    const run = async () => {
      try {
        setLoadingTabs(true);
        setOpError("");
        const sheetId = settings?.packingUnpackingSpreadsheetId || settings?.spreadsheetId || "";
        if (!sheetId) {
          setTabs([]);
          return;
        }
        const res = await getSheetTabs(sheetId);
        setTabs(res?.tabs || []);
      } catch (e) {
        setOpError(e?.message || String(e));
      } finally {
        setLoadingTabs(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.packingUnpackingSpreadsheetId, settings?.spreadsheetId]);

  const updateSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.clear();
      }
    } catch {
      // ignore
    } finally {
      scannerRef.current = null;
      setIsScanning(false);
    }
  };

  const resetOperation = async () => {
    setOpStatus("");
    setOpError("");
    setScannedLabel("");
    setRecord(null);
    setRecordRow(null);
    setMatchedColumn(null);
    setShowForm(false);
    setForm({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });

    setOrPackStep("idle");
    setFirstLabel("");
    setFirstRow(null);
    setFirstMatchedColumn(null);
    setShowPackForm(false);
    setPackForm({ packingDate: "", packingQuantity: "", noteAppend: "" });

    await stopScanner();
  };

  const cancel = async () => {
    await resetOperation();
    setActiveMode(null);
  };

  const startMode = async (m) => {
    await resetOperation();
    setActiveMode(m);

    if (m.id === "or-unpack") {
      setOpStatus(tt("Ready. Scan 1 label QR (White Code).", "Listo. Escanea 1 QR (White Code).", "Sẵn sàng. Quét 1 QR (White Code)."));
      return;
    }

    if (m.id === "or-pack") {
      clearPackingSession();
      setOpStatus(
        tt(
          "Ready. Start Scan #1 (White Code).",
          "Listo. Inicia Escaneo #1 (White Code).",
          "Sẵn sàng. Bắt đầu quét #1 (White Code)."
        )
      );
      return;
    }

    alert(
      tt(
        "This mode will be implemented next.",
        "Este modo se implementará después.",
        "Chế độ này sẽ được làm tiếp."
      )
    );
    setActiveMode(null);
  };

  const sheetId = settings?.packingUnpackingSpreadsheetId || settings?.spreadsheetId || "";
  const orTab = settings?.or_tab_label || settings?.orTabLabel || "OR";

  // =========================
  // OR-Unpacking flow
  // =========================
  const onOrUnpackingScanned = async (label) => {
    try {
      setOpError("");
      setOpStatus(tt("Checking label...", "Comprobando etiqueta...", "Đang kiểm tra nhãn..."));
      setScannedLabel(label);

      if (!sheetId) throw new Error(tt("Missing Spreadsheet ID in Setup.", "Falta Spreadsheet ID en Setup.", "Thiếu Spreadsheet ID trong Setup."));
      if (!orTab) throw new Error(tt("Missing OR tab label in Setup.", "Falta OR tab label en Setup.", "Thiếu OR tab label trong Setup."));

      const res = await getUnpackingRecordByLabel({
        spreadsheetId: sheetId,
        sheetName: orTab,
        labelValue: label,
        needs: "or",
      });

      if (!res?.found) {
        setOpError(
          tt(
            `Not found. White Code "${label}" does not match any row in OR tab.`,
            `No encontrado. White Code "${label}" no coincide con ninguna fila en la pestaña OR.`,
            `Không tìm thấy. White Code "${label}" không khớp với dòng nào trong tab OR.`
          )
        );
        setOpStatus("");
        return;
      }

      setRecord(res.record || null);
      setRecordRow(res.rowIndex || null);
      setMatchedColumn(res.matchedColumn || "WHITE CODE");
      setOpStatus(tt("Found. You can enter Unpacking info.", "Encontrado. Puedes ingresar info de Unpacking.", "Đã tìm thấy. Bạn có thể nhập thông tin Unpacking."));
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  const startOrUnpackingScan = async () => {
    await resetOperation();
    setActiveMode({ id: "or-unpack", label: "OR-Unpacking" });
    setOpStatus(tt("Scanning...", "Escaneando...", "Đang quét..."));
    setIsScanning(true);

    const Html5QrcodeScanner = window.Html5QrcodeScanner;
    if (!Html5QrcodeScanner) {
      setOpError(tt("Scanner library not loaded (html5-qrcode).", "No se cargó la librería (html5-qrcode).", "Chưa tải thư viện quét (html5-qrcode)."));
      setIsScanning(false);
      return;
    }

    const scanner = new Html5QrcodeScanner(
      "packing-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scannerRef.current = scanner;

    scanner.render(
      async (decodedText) => {
        if (scanLockRef.current) return;
        scanLockRef.current = true;
        const code = String(decodedText || "").trim();
        try {
          if (!code) return;
          await stopScanner();
          await onOrUnpackingScanned(code);
        } finally {
          scanLockRef.current = false;
        }
      },
      () => {}
    );
  };

  const openUnpackingForm = () => {
    setForm({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });
    setShowForm(true);
  };

  const saveUnpacking = async () => {
    setOpError("");
    if (!recordRow) {
      setOpError(
        tt(
          "Missing row index. Cancel and scan again.",
          "Falta el índice de fila. Cancela y escanea de nuevo.",
          "Thiếu chỉ số dòng. Hủy và quét lại."
        )
      );
      return;
    }

    if (isBlank(form.unpackingDate) || isBlank(form.unpackingQuantity)) {
      setOpError(
        tt(
          "Unpacking Date and Unpacking Quantity are required.",
          "Se requieren Unpacking Date y Unpacking Quantity.",
          "Cần nhập Unpacking Date và Unpacking Quantity."
        )
      );
      return;
    }

    try {
      setOpStatus(tt("Saving...", "Guardando...", "Đang lưu..."));
      await updateUnpackingByRow({
        spreadsheetId: sheetId,
        sheetName: orTab,
        rowIndex: recordRow,
        unpackingDate: String(form.unpackingDate).trim(),
        unpackingQuantity: String(form.unpackingQuantity).trim(),
        noteAppend: String(form.noteAppend || "").trim(),
        needs: "or",
      });

      setOpStatus(tt("Saved. Ready for next scan.", "Guardado. Listo para el siguiente escaneo.", "Đã lưu. Sẵn sàng quét tiếp."));
      setShowForm(false);
      setForm({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });
      setScannedLabel("");
      setRecord(null);
      setRecordRow(null);
      setMatchedColumn(null);
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  const unpackingAlreadyExists = (() => {
    const d = pickCI(record || {}, "UNPACKING DATE", "Unpacking Date");
    const q = pickCI(record || {}, "UNPACKING QUANTITY", "Unpacking Quantity");
    return !isBlank(d) || !isBlank(q);
  })();

  // =========================
  // OR-Packing flow (2 scans)
  // =========================
  function clearPackingSession() {
    setOrPackStep("idle");
    setFirstLabel("");
    setFirstRow(null);
    setFirstMatchedColumn(null);
    setShowPackForm(false);
    setPackForm({ packingDate: "", packingQuantity: "", noteAppend: "" });
    setScannedLabel("");
    setRecord(null);
    setRecordRow(null);
    setMatchedColumn(null);
    setOpError("");
  }

  const startOrPackingScanFirst = async () => {
    clearPackingSession();
    setOpStatus(tt("Scanning #1...", "Escaneando #1...", "Đang quét #1..."));
    setIsScanning(true);
    setOrPackStep("scan1");

    const Html5QrcodeScanner = window.Html5QrcodeScanner;
    if (!Html5QrcodeScanner) {
      setOpError(tt("Scanner library not loaded (html5-qrcode).", "No se cargó la librería (html5-qrcode).", "Chưa tải thư viện quét (html5-qrcode)."));
      setIsScanning(false);
      setOrPackStep("idle");
      return;
    }

    const scanner = new Html5QrcodeScanner(
      "packing-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scannerRef.current = scanner;

    scanner.render(
      async (decodedText) => {
        if (scanLockRef.current) return;
        scanLockRef.current = true;
        const code = String(decodedText || "").trim();
        try {
          if (!code) return;
          await stopScanner();
          await onOrPackingFirstScanned(code);
        } finally {
          scanLockRef.current = false;
        }
      },
      () => {}
    );
  };

  const onOrPackingFirstScanned = async (label) => {
    try {
      setOpError("");
      if (!sheetId) throw new Error(tt("Missing Spreadsheet ID in Setup.", "Falta Spreadsheet ID en Setup.", "Thiếu Spreadsheet ID trong Setup."));
      if (!orTab) throw new Error(tt("Missing OR tab label in Setup.", "Falta OR tab label en Setup.", "Thiếu OR tab label trong Setup."));

      setOpStatus(tt("Checking #1...", "Comprobando #1...", "Đang kiểm tra #1..."));

      const res = await getPackingRecordByLabel({
        spreadsheetId: sheetId,
        sheetName: orTab,
        labelValue: label,
        needs: "or",
      });

      if (!res?.found) {
        setOpError(
          tt(
            `Not found. White Code "${label}" does not match any row in OR tab.`,
            `No encontrado. White Code "${label}" no coincide con ninguna fila en la pestaña OR.`,
            `Không tìm thấy. White Code "${label}" không khớp với dòng nào trong tab OR.`
          )
        );
        setOpStatus("");
        setOrPackStep("idle");
        return;
      }

      setFirstLabel(label);
      setFirstRow(res.rowIndex || null);
      setFirstMatchedColumn(res.matchedColumn || "WHITE CODE");

      setOpStatus(
        tt(
          "Scan #1 OK. Now start Scan #2 (must match Scan #1).",
          "Escaneo #1 OK. Ahora inicia Escaneo #2 (debe coincidir con #1).",
          "Quét #1 OK. Bắt đầu quét #2 (phải khớp #1)."
        )
      );
      setOrPackStep("scan2");
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
      setOrPackStep("idle");
    }
  };

  const startOrPackingScanSecond = async () => {
    setOpError("");
    if (isBlank(firstLabel) || !firstRow) {
      setOpError(
        tt(
          "Missing Scan #1. Start Scan #1 first.",
          "Falta Escaneo #1. Inicia Escaneo #1 primero.",
          "Thiếu quét #1. Hãy quét #1 trước."
        )
      );
      return;
    }

    setOpStatus(tt("Scanning #2...", "Escaneando #2...", "Đang quét #2..."));
    setIsScanning(true);

    const Html5QrcodeScanner = window.Html5QrcodeScanner;
    if (!Html5QrcodeScanner) {
      setOpError(tt("Scanner library not loaded (html5-qrcode).", "No se cargó la librería (html5-qrcode).", "Chưa tải thư viện quét (html5-qrcode)."));
      setIsScanning(false);
      return;
    }

    const scanner = new Html5QrcodeScanner(
      "packing-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scannerRef.current = scanner;

    scanner.render(
      async (decodedText) => {
        if (scanLockRef.current) return;
        scanLockRef.current = true;
        const code = String(decodedText || "").trim();
        try {
          if (!code) return;
          await stopScanner();
          await onOrPackingSecondScanned(code);
        } finally {
          scanLockRef.current = false;
        }
      },
      () => {}
    );
  };

  const onOrPackingSecondScanned = async (label) => {
    try {
      setOpError("");
      setOpStatus(tt("Checking #2...", "Comprobando #2...", "Đang kiểm tra #2..."));

      const n1 = normalizeCodeForCompare(firstLabel);
      const n2 = normalizeCodeForCompare(label);

      if (!n2 || n1 !== n2) {
        setOpError(
          tt(
            "Mismatch. Scan #2 must be the same White Code as Scan #1.",
            "No coincide. El Escaneo #2 debe ser el mismo White Code que #1.",
            "Không khớp. Quét #2 phải là cùng White Code với #1."
          )
        );
        setOpStatus("");
        // Keep mode; let user retry
        setOrPackStep("idle");
        setFirstLabel("");
        setFirstRow(null);
        setFirstMatchedColumn(null);
        return;
      }

      const res2 = await getPackingRecordByLabel({
        spreadsheetId: sheetId,
        sheetName: orTab,
        labelValue: label,
        needs: "or",
      });

      if (!res2?.found) {
        setOpError(
          tt(
            `Not found. White Code "${label}" does not match any row in OR tab.`,
            `No encontrado. White Code "${label}" no coincide con ninguna fila en la pestaña OR.`,
            `Không tìm thấy. White Code "${label}" không khớp với dòng nào trong tab OR.`
          )
        );
        setOpStatus("");
        setOrPackStep("idle");
        return;
      }

      if (Number(res2.rowIndex) !== Number(firstRow)) {
        setOpError(
          tt(
            "Mismatch. Scan #2 does not resolve to the same row as Scan #1.",
            "No coincide. El Escaneo #2 no corresponde a la misma fila que #1.",
            "Không khớp. Quét #2 không trỏ tới cùng dòng với quét #1."
          )
        );
        setOpStatus("");
        setOrPackStep("idle");
        setFirstLabel("");
        setFirstRow(null);
        setFirstMatchedColumn(null);
        return;
      }

      setScannedLabel(firstLabel);
      setRecord(res2.record || null);
      setRecordRow(firstRow);
      setMatchedColumn(firstMatchedColumn || res2.matchedColumn || "WHITE CODE");

      setOpStatus(
        tt(
          "Matched. Record loaded. Enter Packing info.",
          "Coincide. Registro cargado. Ingresa info de Packing.",
          "Khớp. Đã tải bản ghi. Nhập thông tin Packing."
        )
      );
      setOrPackStep("ready");
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
      setOrPackStep("idle");
    }
  };

  const openPackingForm = () => {
    setPackForm({ packingDate: "", packingQuantity: "", noteAppend: "" });
    setShowPackForm(true);
  };

  const savePacking = async () => {
    setOpError("");
    if (!recordRow) {
      setOpError(
        tt(
          "Missing row index. Cancel and scan again.",
          "Falta el índice de fila. Cancela y escanea de nuevo.",
          "Thiếu chỉ số dòng. Hủy và quét lại."
        )
      );
      return;
    }

    if (isBlank(packForm.packingDate) || isBlank(packForm.packingQuantity)) {
      setOpError(
        tt(
          "Packing Date and Packing Quantity are required.",
          "Se requieren Packing Date y Packing Quantity.",
          "Cần nhập Packing Date và Packing Quantity."
        )
      );
      return;
    }

    try {
      setOpStatus(tt("Saving...", "Guardando...", "Đang lưu..."));
      await updatePackingByRow({
        spreadsheetId: sheetId,
        sheetName: orTab,
        rowIndex: recordRow,
        packingDate: String(packForm.packingDate).trim(),
        packingQuantity: String(packForm.packingQuantity).trim(),
        noteAppend: String(packForm.noteAppend || "").trim(),
        needs: "or",
      });

      setOpStatus(tt("Saved. Ready for next scan.", "Guardado. Listo para el siguiente escaneo.", "Đã lưu. Sẵn sàng quét tiếp."));
      setShowPackForm(false);
      setPackForm({ packingDate: "", packingQuantity: "", noteAppend: "" });
      setScannedLabel("");
      setRecord(null);
      setRecordRow(null);
      setMatchedColumn(null);
      setOrPackStep("idle");
      setFirstLabel("");
      setFirstRow(null);
      setFirstMatchedColumn(null);
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  const packingAlreadyExists = (() => {
    const d = pickCI(record || {}, "PACKING DATE", "Packing Date");
    const q = pickCI(record || {}, "PACKING QUANTITY", "Packing Quantity");
    return !isBlank(d) || !isBlank(q);
  })();

  return (
    <div className="page">
      <div className="page-header">
        <h2>{tt("Packing / Unpacking Management", "Gestión de Empaque / Desempaque", "Quản lý Đóng gói / Mở gói")}</h2>
      </div>

      {/* Setup */}
      <div className="card">
        <h3>{tt("Setup", "Configuración", "Cài đặt")}</h3>

        <div className="grid-2">
          <div className="field">
            <label>{tt("Spreadsheet ID", "ID de Spreadsheet", "Spreadsheet ID")}</label>
            <input
              value={settings?.packingUnpackingSpreadsheetId || ""}
              onChange={(e) => updateSettings({ packingUnpackingSpreadsheetId: e.target.value })}
              placeholder={tt("Paste Spreadsheet ID", "Pega el Spreadsheet ID", "Dán Spreadsheet ID")}
            />
            <div className="hint">
              {tt(
                "Used for OR and GRAFTING tabs in your Packing-Unpacking log sheet.",
                "Se usa para las pestañas OR y GRAFTING en tu hoja de Packing-Unpacking.",
                "Dùng cho tab OR và GRAFTING trong sheet Packing-Unpacking."
              )}
            </div>
          </div>

          <div className="field">
            <label>{tt("OR tab label", "Etiqueta de pestaña OR", "Tên tab OR")}</label>
            <select
              value={settings?.or_tab_label || ""}
              onChange={(e) => updateSettings({ or_tab_label: e.target.value })}
              disabled={loadingTabs || !tabs.length}
            >
              <option value="">{loadingTabs ? tt("Loading...", "Cargando...", "Đang tải...") : tt("Select tab", "Selecciona pestaña", "Chọn tab")}</option>
              {tabs.map((tab) => (
                <option key={tab} value={tab}>
                  {tab}
                </option>
              ))}
            </select>
            <div className="hint">{tt("This tab is used by OR-Packing and OR-Unpacking.", "Esta pestaña se usa para OR-Packing y OR-Unpacking.", "Tab này dùng cho OR-Packing và OR-Unpacking.")}</div>
          </div>
        </div>
      </div>

      {/* Modes */}
      <div className="card">
        <h3>{tt("Modes", "Modos", "Chế độ")}</h3>

        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={activeMode?.id === m.id ? "btn-primary" : ""}
              onClick={() => startMode(m)}
            >
              {m.label}
            </button>
          ))}
          {activeMode && (
            <button onClick={cancel}>{tt("Close", "Cerrar", "Đóng")}</button>
          )}
        </div>
      </div>

      {/* OR-Packing */}
      {activeMode?.id === "or-pack" && (
        <div className="card">
          <h3>{tt("OR-Packing", "OR-Empaque", "OR-Đóng gói")}</h3>

          {(opStatus || opError) && (
            <div style={{ marginBottom: 10 }}>
              {opStatus && <div className="alert">{opStatus}</div>}
              {opError && <div className="alert alert-error">{opError}</div>}
            </div>
          )}

          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
            {tt(
              "Rule: Scan #1 White Code must exist in OR tab. Scan #2 must match the same White Code (and same row).",
              "Regla: El White Code del Escaneo #1 debe existir en la pestaña OR. El Escaneo #2 debe coincidir con el mismo White Code (y misma fila).",
              "Quy tắc: Quét #1 White Code phải tồn tại trong tab OR. Quét #2 phải khớp cùng White Code (và cùng dòng)."
            )}
          </div>

          {/* Scan area */}
          {!record && !showPackForm && (
            <>
              {firstLabel && (
                <div style={{ fontSize: 13, marginBottom: 10, opacity: 0.9 }}>
                  {tt("Scan #1:", "Escaneo #1:", "Quét #1:")} <b>{firstLabel}</b>
                </div>
              )}

              {!isScanning ? (
                <div className="btn-row">
                  {orPackStep === "idle" && (
                    <button className="btn-primary" onClick={startOrPackingScanFirst}>
                      {tt("Start Scan #1", "Iniciar Escaneo #1", "Bắt đầu quét #1")}
                    </button>
                  )}
                  {orPackStep === "scan2" && (
                    <button className="btn-primary" onClick={startOrPackingScanSecond}>
                      {tt("Start Scan #2", "Iniciar Escaneo #2", "Bắt đầu quét #2")}
                    </button>
                  )}
                  <button onClick={clearPackingSession}>{tt("Reset", "Reiniciar", "Đặt lại")}</button>
                </div>
              ) : (
                <>
                  <div id="packing-reader" style={{ width: "100%", maxWidth: 420 }} />
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button onClick={stopScanner}>{tt("Stop", "Detener", "Dừng")}</button>
                  </div>
                </>
              )}
            </>
          )}

          {/* Record summary */}
          {record && !showPackForm && (
            <>
              <div style={{ marginTop: 6, marginBottom: 10, fontSize: 13 }}>
                {tt("Matched White Code:", "White Code coincidente:", "White Code khớp:")}{" "}
                <b>{scannedLabel}</b>
                {matchedColumn ? (
                  <span style={{ opacity: 0.7 }}>
                    {" "}
                    ({tt("matched by", "coincidió por", "khớp theo")}: {matchedColumn})
                  </span>
                ) : null}
              </div>

              {packingAlreadyExists && (
                <div className="alert" style={{ marginBottom: 10 }}>
                  {tt(
                    "This record already has Packing data. You can edit and save again.",
                    "Este registro ya tiene datos de Packing. Puedes editar y guardar de nuevo.",
                    "Bản ghi này đã có dữ liệu Packing. Bạn có thể chỉnh sửa và lưu lại."
                  )}
                </div>
              )}

              <table className="mini-table">
                <tbody>
                  <tr>
                    <td>{tt("White Code", "White Code", "White Code")}</td>
                    <td><b>{pickCI(record, "WHITE CODE")}</b></td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Name", "Nombre de Variedad", "Tên giống")}</td>
                    <td>{pickCI(record, "VARIETY NAME")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Code", "Código de Variedad", "Mã giống")}</td>
                    <td>{pickCI(record, "VARIETY CODE")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Packing Qty", "Cant. Empaque", "SL đóng gói")}</td>
                    <td>{pickCI(record, "PACKING QUANTITY")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Packing Date", "Fecha de Empaque", "Ngày đóng gói")}</td>
                    <td>{pickCI(record, "PACKING DATE")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Note", "Nota", "Ghi chú")}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{pickCI(record, "NOTE")}</td>
                  </tr>
                </tbody>
              </table>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={openPackingForm}>
                  {packingAlreadyExists
                    ? tt("Edit Packing", "Editar Packing", "Sửa Packing")
                    : tt("Enter Packing", "Ingresar Packing", "Nhập Packing")}
                </button>
                <button
                  onClick={async () => {
                    await resetOperation();
                    setActiveMode({ id: "or-pack", label: "OR-Packing" });
                    setOpStatus(tt("Ready. Start Scan #1 (White Code).", "Listo. Inicia Escaneo #1 (White Code).", "Sẵn sàng. Bắt đầu quét #1 (White Code)."));
                  }}
                >
                  {tt("Scan Another", "Escanear Otro", "Quét tiếp")}
                </button>
              </div>
            </>
          )}

          {/* Packing form modal */}
          {showPackForm && (
            <div className="modal">
              <div className="modal-content">
                <h3>{tt("OR-Packing Form", "Formulario OR-Packing", "Form OR-Packing")}</h3>

                <div className="grid-2">
                  <div className="field">
                    <label>{tt("Packing Date", "Fecha de Packing", "Ngày đóng gói")}</label>
                    <input
                      type="date"
                      value={packForm.packingDate}
                      onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label>{tt("Packing Quantity", "Cantidad Packing", "Số lượng đóng gói")}</label>
                    <input
                      inputMode="numeric"
                      value={packForm.packingQuantity}
                      onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))}
                      placeholder={tt("e.g. 100", "p.ej. 100", "vd: 100")}
                    />
                  </div>
                </div>

                <div className="field">
                  <label>{tt("Note (append)", "Nota (agregar)", "Ghi chú (thêm)")}</label>
                  <textarea
                    rows={4}
                    value={packForm.noteAppend}
                    onChange={(e) => setPackForm((p) => ({ ...p, noteAppend: e.target.value }))}
                    placeholder={tt("Optional", "Opcional", "Không bắt buộc")}
                  />
                </div>

                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={savePacking}>
                    {tt("Save", "Guardar", "Lưu")}
                  </button>
                  <button onClick={() => setShowPackForm(false)}>{tt("Cancel", "Cancelar", "Hủy")}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* OR-Unpacking */}
      {activeMode?.id === "or-unpack" && (
        <div className="card">
          <h3>{tt("OR-Unpacking", "OR-Desempaque", "OR-Mở gói")}</h3>

          {(opStatus || opError) && (
            <div style={{ marginBottom: 10 }}>
              {opStatus && <div className="alert">{opStatus}</div>}
              {opError && <div className="alert alert-error">{opError}</div>}
            </div>
          )}

          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
            {tt(
              "Scan 1 QR. It must match WHITE CODE in the OR tab.",
              "Escanea 1 QR. Debe coincidir con WHITE CODE en la pestaña OR.",
              "Quét 1 QR. Phải khớp WHITE CODE trong tab OR."
            )}
          </div>

          {!record && !isScanning && (
            <div className="btn-row">
              <button className="btn-primary" onClick={startOrUnpackingScan}>
                {tt("Start Scan", "Iniciar Escaneo", "Bắt đầu quét")}
              </button>
              <button onClick={resetOperation}>{tt("Reset", "Reiniciar", "Đặt lại")}</button>
            </div>
          )}

          {isScanning && (
            <>
              <div id="packing-reader" style={{ width: "100%", maxWidth: 420 }} />
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button onClick={stopScanner}>{tt("Stop", "Detener", "Dừng")}</button>
              </div>
            </>
          )}

          {record && (
            <>
              <div style={{ marginTop: 6, marginBottom: 10, fontSize: 13 }}>
                {tt("Scanned:", "Escaneado:", "Đã quét:")} <b>{scannedLabel}</b>
                {matchedColumn ? (
                  <span style={{ opacity: 0.7 }}>
                    {" "}
                    ({tt("matched by", "coincidió por", "khớp theo")}: {matchedColumn})
                  </span>
                ) : null}
              </div>

              {unpackingAlreadyExists && (
                <div className="alert" style={{ marginBottom: 10 }}>
                  {tt(
                    "This record already has Unpacking data. You can edit and save again.",
                    "Este registro ya tiene datos de Unpacking. Puedes editar y guardar de nuevo.",
                    "Bản ghi này đã có dữ liệu Unpacking. Bạn có thể chỉnh sửa và lưu lại."
                  )}
                </div>
              )}

              <table className="mini-table">
                <tbody>
                  <tr>
                    <td>{tt("White Code", "White Code", "White Code")}</td>
                    <td><b>{pickCI(record, "WHITE CODE")}</b></td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Name", "Nombre de Variedad", "Tên giống")}</td>
                    <td>{pickCI(record, "VARIETY NAME")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Code", "Código de Variedad", "Mã giống")}</td>
                    <td>{pickCI(record, "VARIETY CODE")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Unpacking Qty", "Cant. Desempaque", "SL mở gói")}</td>
                    <td>{pickCI(record, "UNPACKING QUANTITY")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Unpacking Date", "Fecha de Desempaque", "Ngày mở gói")}</td>
                    <td>{pickCI(record, "UNPACKING DATE")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Note", "Nota", "Ghi chú")}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{pickCI(record, "NOTE")}</td>
                  </tr>
                </tbody>
              </table>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={openUnpackingForm}>
                  {unpackingAlreadyExists
                    ? tt("Edit Unpacking", "Editar Unpacking", "Sửa Unpacking")
                    : tt("Enter Unpacking", "Ingresar Unpacking", "Nhập Unpacking")}
                </button>
                <button
                  onClick={async () => {
                    await resetOperation();
                    setActiveMode({ id: "or-unpack", label: "OR-Unpacking" });
                    setOpStatus(tt("Ready. Scan 1 label QR (White Code).", "Listo. Escanea 1 QR (White Code).", "Sẵn sàng. Quét 1 QR (White Code)."));
                  }}
                >
                  {tt("Scan Another", "Escanear Otro", "Quét tiếp")}
                </button>
              </div>
            </>
          )}

          {/* Unpacking form modal */}
          {showForm && (
            <div className="modal">
              <div className="modal-content">
                <h3>{tt("OR-Unpacking Form", "Formulario OR-Unpacking", "Form OR-Unpacking")}</h3>

                <div className="grid-2">
                  <div className="field">
                    <label>{tt("Unpacking Date", "Fecha de Unpacking", "Ngày mở gói")}</label>
                    <input
                      type="date"
                      value={form.unpackingDate}
                      onChange={(e) => setForm((p) => ({ ...p, unpackingDate: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label>{tt("Unpacking Quantity", "Cantidad Unpacking", "Số lượng mở gói")}</label>
                    <input
                      inputMode="numeric"
                      value={form.unpackingQuantity}
                      onChange={(e) => setForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                      placeholder={tt("e.g. 100", "p.ej. 100", "vd: 100")}
                    />
                  </div>
                </div>

                <div className="field">
                  <label>{tt("Note (append)", "Nota (agregar)", "Ghi chú (thêm)")}</label>
                  <textarea
                    rows={4}
                    value={form.noteAppend}
                    onChange={(e) => setForm((p) => ({ ...p, noteAppend: e.target.value }))}
                    placeholder={tt("Optional", "Opcional", "Không bắt buộc")}
                  />
                </div>

                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={saveUnpacking}>
                    {tt("Save", "Guardar", "Lưu")}
                  </button>
                  <button onClick={() => setShowForm(false)}>{tt("Cancel", "Cancelar", "Hủy")}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
