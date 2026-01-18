import React, { useEffect, useMemo, useRef, useState } from "react";
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

  // Accept either full URL or plain ID
  // URL pattern: /spreadsheets/d/<ID>
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && m[1]) return m[1];

  // If user pasted just the ID (usually long, no slashes)
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;

  return "";
}

// ----------------------------
// component
// ----------------------------
export default function PackingUnpackingManagementPage() {
  const { lang, t } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  const [settings, setSettings] = useState(() => loadSettings() || {});
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Setup state (link -> spreadsheetId)
  const [sheetLink, setSheetLink] = useState(() => settings?.packingUnpackingUrl || settings?.packingUrl || "");
  const derivedSheetId = useMemo(() => {
    // Prefer explicit id if present, otherwise derive from link
    return (
      extractSpreadsheetId(settings?.packingUnpackingSpreadsheetId) ||
      extractSpreadsheetId(sheetLink) ||
      ""
    );
  }, [settings?.packingUnpackingSpreadsheetId, sheetLink]);

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
    if (/^\d+$/.test(s)) {
      const stripped = s.replace(/^0+/, "");
      return (stripped === "" ? "0" : stripped).toLowerCase();
    }
    return s.toLowerCase();
  };

  const updateSettings = (patch) => {
    const next = { ...(settings || {}), ...(patch || {}) };
    setSettings(next);
    saveSettings(next);
  };

  // Persist sheet link + derived ID when link changes
  useEffect(() => {
    const id = extractSpreadsheetId(sheetLink);
    updateSettings({
      packingUnpackingUrl: sheetLink,
      packingUnpackingSpreadsheetId: id || "", // keep empty if invalid
      packingSpreadsheetId: id || "", // IMPORTANT compatibility key
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetLink]);

  // Load tabs automatically when we have a valid sheet id
  useEffect(() => {
    const run = async () => {
      try {
        setLoadingTabs(true);
        setOpError("");

        if (!derivedSheetId) {
          setTabs([]);
          return;
        }

        const res = await getSheetTabs(derivedSheetId);
        setTabs(res?.tabs || res || []);
      } catch (e) {
        setTabs([]);
        setOpError(e?.message || String(e));
      } finally {
        setLoadingTabs(false);
      }
    };
    run();
  }, [derivedSheetId]);

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
      setOpStatus(tt("Ready. Start Scan #1 (White Code).", "Listo. Inicia Escaneo #1 (White Code).", "Sẵn sàng. Bắt đầu quét #1 (White Code)."));
      return;
    }

    alert(tt("This mode will be implemented next.", "Este modo se implementará después.", "Chế độ này sẽ được làm tiếp."));
    setActiveMode(null);
  };

  // Use setup values
  const sheetId = derivedSheetId;
  const orTab = String(settings?.or_tab_label || settings?.orTabLabel || "OR").trim();
  const graftingTab = String(settings?.grafting_tab_label || settings?.graftingTabLabel || "GRAFTING").trim();

  // =========================
  // OR-Unpacking flow
  // =========================
  const onOrUnpackingScanned = async (label) => {
    try {
      setOpError("");
      setOpStatus(tt("Checking label...", "Comprobando etiqueta...", "Đang kiểm tra nhãn..."));
      setScannedLabel(label);

      if (!sheetId) throw new Error(tt("Missing/invalid Packing sheet link in Setup.", "Falta/ID inválido del sheet en Setup.", "Thiếu link sheet Packing hợp lệ trong Setup."));
      if (!orTab) throw new Error(tt("Missing OR tab label in Setup.", "Falta OR tab en Setup.", "Thiếu tên tab OR trong Setup."));

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
      setOpStatus(tt("Found. You can enter Unpacking info.", "Encontrado. Puedes ingresar Unpacking.", "Đã tìm thấy. Bạn có thể nhập thông tin Unpacking."));
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  // =========================
  // OR-Packing flow
  // =========================
  const onOrPackingScan1 = async (label) => {
    try {
      setOpError("");
      setOpStatus(tt("Checking Scan #1...", "Comprobando Escaneo #1...", "Đang kiểm tra quét #1..."));

      if (!sheetId) throw new Error(tt("Missing/invalid Packing sheet link in Setup.", "Falta/ID inválido del sheet en Setup.", "Thiếu link sheet Packing hợp lệ trong Setup."));
      if (!orTab) throw new Error(tt("Missing OR tab label in Setup.", "Falta OR tab en Setup.", "Thiếu tên tab OR trong Setup."));

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
        return;
      }

      setFirstLabel(label);
      setFirstRow(res.rowIndex || null);
      setFirstMatchedColumn(res.matchedColumn || "WHITE CODE");
      setOrPackStep("scan2");
      setOpStatus(tt("Scan #1 OK. Now scan #2 (must match the same White Code).", "Escaneo #1 OK. Ahora escanea #2 (debe coincidir).", "Quét #1 OK. Quét #2 (phải khớp cùng White Code)."));
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  const onOrPackingScan2 = async (label2) => {
    try {
      setOpError("");
      setOpStatus(tt("Validating Scan #2...", "Validando Escaneo #2...", "Đang kiểm tra quét #2..."));

      if (!firstLabel || !firstRow) throw new Error(tt("Missing Scan #1 context. Reset and try again.", "Falta contexto del Escaneo #1. Reinicia.", "Thiếu dữ liệu quét #1. Hãy đặt lại."));

      // Rule: scan #2 must match scan #1 (case-insensitive, numeric leading zeros ignored)
      const a = normalizeCodeForCompare(firstLabel);
      const b = normalizeCodeForCompare(label2);
      if (!a || !b || a !== b) {
        setOpError(
          tt(
            `Mismatch. Scan #2 "${label2}" must match Scan #1 "${firstLabel}".`,
            `No coincide. Escaneo #2 "${label2}" debe coincidir con Escaneo #1 "${firstLabel}".`,
            `Không khớp. Quét #2 "${label2}" phải khớp với quét #1 "${firstLabel}".`
          )
        );
        setOpStatus("");
        setOrPackStep("scan2");
        return;
      }

      // Re-load record (safe) then show packing form
      const res = await getPackingRecordByLabel({
        spreadsheetId: sheetId,
        sheetName: orTab,
        labelValue: firstLabel,
        needs: "or",
      });

      if (!res?.found) {
        setOpError(
          tt(
            `Record disappeared. "${firstLabel}" not found in OR tab. Cancel and try again.`,
            `El registro desapareció. "${firstLabel}" no está en la pestaña OR. Cancela e intenta de nuevo.`,
            `Không tìm thấy lại bản ghi. "${firstLabel}" không có trong tab OR. Hủy và thử lại.`
          )
        );
        setOpStatus("");
        return;
      }

      setRecord(res.record || null);
      setRecordRow(res.rowIndex || null);
      setMatchedColumn(res.matchedColumn || "WHITE CODE");

      setOrPackStep("ready");
      setOpStatus(tt("Matched. You can enter Packing info.", "Coincide. Puedes ingresar Packing.", "Khớp. Bạn có thể nhập thông tin Packing."));
      setShowPackForm(true);
    } catch (e) {
      setOpError(e?.message || String(e));
      setOpStatus("");
    }
  };

  const saveUnpacking = async () => {
    setOpError("");
    if (!recordRow) {
      setOpError(tt("Missing rowIndex. Cancel and scan again.", "Falta rowIndex. Cancela y escanea de nuevo.", "Thiếu rowIndex. Hủy và quét lại."));
      return;
    }
    if (isBlank(form.unpackingDate) || isBlank(form.unpackingQuantity)) {
      setOpError(tt("Unpacking Date and Unpacking Quantity are required.", "Unpacking Date y Quantity son requeridos.", "Cần nhập Unpacking Date và Quantity."));
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

  const savePacking = async () => {
    setOpError("");
    if (!recordRow) {
      setOpError(tt("Missing rowIndex. Cancel and scan again.", "Falta rowIndex. Cancela y escanea de nuevo.", "Thiếu rowIndex. Hủy và quét lại."));
      return;
    }
    if (isBlank(packForm.packingDate) || isBlank(packForm.packingQuantity)) {
      setOpError(tt("Packing Date and Packing Quantity are required.", "Packing Date y Quantity son requeridos.", "Cần nhập Packing Date và Quantity."));
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

  const unpackingAlreadyExists = (() => {
    const d = pickCI(record || {}, "UNPACKING DATE", "Unpacking Date");
    const q = pickCI(record || {}, "UNPACKING QUANTITY", "Unpacking Quantity");
    return !isBlank(d) || !isBlank(q);
  })();

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
            <label>{tt("Packing Sheet link (Google Sheet URL)", "Link de Sheet (URL)", "Link Google Sheet")}</label>
            <input
              value={sheetLink}
              onChange={(e) => setSheetLink(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
            <div className="hint">
              {tt(
                "Paste the Google Sheet link. The app will extract Spreadsheet ID automatically and load tabs.",
                "Pega el link del Google Sheet. La app extrae el ID y carga las pestañas.",
                "Dán link Google Sheet. App tự tách Spreadsheet ID và tải danh sách tab."
              )}
            </div>

            {derivedSheetId ? (
              <div className="alert" style={{ marginTop: 8 }}>
                <b>{tt("Spreadsheet ID:", "Spreadsheet ID:", "Spreadsheet ID:")}</b> {derivedSheetId}
              </div>
            ) : (
              <div className="alert alert-error" style={{ marginTop: 8 }}>
                {tt(
                  "Invalid link (cannot find Spreadsheet ID).",
                  "Link inválido (no se encontró Spreadsheet ID).",
                  "Link không hợp lệ (không tìm thấy Spreadsheet ID)."
                )}
              </div>
            )}
          </div>

          <div className="field">
            <label>{tt("OR tab label", "Etiqueta de pestaña OR", "Tên tab OR")}</label>
            <select
              value={settings?.or_tab_label || ""}
              onChange={(e) => updateSettings({ or_tab_label: e.target.value, packingOrSheetName: e.target.value, // IMPORTANT compatibility key })}
              disabled={loadingTabs || !tabs.length}
            >
              <option value="">
                {loadingTabs
                  ? tt("Loading...", "Cargando...", "Đang tải...")
                  : tt("Select tab", "Selecciona pestaña", "Chọn tab")}
              </option>
              {tabs.map((tab) => (
                <option key={tab} value={tab}>
                  {tab}
                </option>
              ))}
            </select>
            <div className="hint">{tt("Used by OR-Packing and OR-Unpacking.", "Usado por OR-Packing y OR-Unpacking.", "Dùng cho OR-Packing và OR-Unpacking.")}</div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>{tt("GRAFTING tab label", "Etiqueta de pestaña GRAFTING", "Tên tab GRAFTING")}</label>
              <select
                value={settings?.grafting_tab_label || ""}
                onChange={(e) => updateSettings({ grafting_tab_label: e.target.value, packingGraftingSheetName: e.target.value, // IMPORTANT compatibility key })}
                disabled={loadingTabs || !tabs.length}
              >
                <option value="">
                  {loadingTabs
                    ? tt("Loading...", "Cargando...", "Đang tải...")
                    : tt("Select tab", "Selecciona pestaña", "Chọn tab")}
                </option>
                {tabs.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
              </select>
              <div className="hint">{tt("Used by Grafting-Packing and Grafting-Unpacking (later).", "Usado por modos de Injerto (después).", "Dùng cho các chế độ Ghép (làm sau).")}</div>
            </div>
          </div>
        </div>

        {opError && <div className="alert alert-error" style={{ marginTop: 10 }}>{opError}</div>}
      </div>

      {/* Modes */}
      <div className="card">
        <h3>{tt("Modes", "Modos", "Chế độ")}</h3>

        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m.id} className={activeMode?.id === m.id ? "btn-primary" : ""} onClick={() => startMode(m)}>
              {m.label}
            </button>
          ))}
          {activeMode && <button onClick={cancel}>{tt("Close", "Cerrar", "Đóng")}</button>}
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
              "Rule: Scan #1 White Code must exist in OR tab. Scan #2 must match the same White Code (same value, ignore leading zeros).",
              "Regla: Escaneo #1 debe existir en OR. Escaneo #2 debe coincidir con el mismo White Code.",
              "Quy tắc: Quét #1 phải có trong tab OR. Quét #2 phải khớp đúng White Code (bỏ qua số 0 đầu)."
            )}
          </div>

          {!showPackForm && (
            <div className="alert" style={{ marginBottom: 10 }}>
              <b>{tt("Step:", "Paso:", "Bước:")}</b>{" "}
              {orPackStep === "idle"
                ? tt("Scan #1", "Escaneo #1", "Quét #1")
                : orPackStep === "scan2"
                ? tt("Scan #2", "Escaneo #2", "Quét #2")
                : tt("Ready", "Listo", "Sẵn sàng")}
            </div>
          )}

          {/* Manual scan inputs (keeps your existing scanner logic separate if you re-add it) */}
          {!showPackForm && (
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                placeholder={tt(
                  orPackStep === "scan2" ? "Paste/scan QR #2 here" : "Paste/scan QR #1 here",
                  orPackStep === "scan2" ? "Pega/escanea QR #2 aquí" : "Pega/escanea QR #1 aquí",
                  orPackStep === "scan2" ? "Dán/quét QR #2 ở đây" : "Dán/quét QR #1 ở đây"
                )}
                value={scannedLabel}
                onChange={(e) => setScannedLabel(e.target.value)}
              />
              <div className="btn-row">
                <button
                  className="btn-primary"
                  onClick={async () => {
                    const v = String(scannedLabel || "").trim();
                    if (!v) return;
                    if (orPackStep === "idle") {
                      setOrPackStep("scan1");
                      await onOrPackingScan1(v);
                    } else if (orPackStep === "scan2") {
                      await onOrPackingScan2(v);
                    } else {
                      // ready -> ignore
                    }
                    setScannedLabel("");
                  }}
                  disabled={!sheetId || !orTab}
                >
                  {tt("Confirm Scan", "Confirmar", "Xác nhận")}
                </button>
                <button onClick={resetOperation}>{tt("Reset", "Reiniciar", "Đặt lại")}</button>
              </div>

              {firstLabel && (
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  {tt("Scan #1:", "Escaneo #1:", "Quét #1:")} <b>{firstLabel}</b>{" "}
                  {firstMatchedColumn ? <span style={{ opacity: 0.7 }}>({tt("matched by", "por", "khớp theo")}: {firstMatchedColumn})</span> : null}
                </div>
              )}

              {packingAlreadyExists && record && (
                <div className="alert">
                  {tt(
                    "This record already has Packing data. You can edit and save again.",
                    "Este registro ya tiene datos de Packing. Puedes editar y guardar otra vez.",
                    "Bản ghi này đã có dữ liệu Packing. Bạn có thể sửa và lưu lại."
                  )}
                </div>
              )}
            </div>
          )}

          {showPackForm && record && (
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <table className="mini-table">
                <tbody>
                  <tr>
                    <td>{tt("White Code", "White Code", "White Code")}</td>
                    <td>
                      <b>{pickCI(record, "WHITE CODE")}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Name", "Nombre de Variedad", "Tên giống")}</td>
                    <td>{pickCI(record, "VARIETY NAME")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Variety Code", "Código de Variedad", "Mã giống")}</td>
                    <td>{pickCI(record, "VARIETY CODE")}</td>
                  </tr>
                </tbody>
              </table>

              <label className="field">
                {tt("Packing Date", "Fecha de Empaque", "Ngày đóng gói")}
                <input
                  type="date"
                  value={packForm.packingDate}
                  onChange={(e) => setPackForm((p) => ({ ...p, packingDate: e.target.value }))}
                />
              </label>

              <label className="field">
                {tt("Packing Quantity", "Cantidad de Empaque", "Số lượng đóng gói")}
                <input
                  type="number"
                  value={packForm.packingQuantity}
                  onChange={(e) => setPackForm((p) => ({ ...p, packingQuantity: e.target.value }))}
                />
              </label>

              <label className="field">
                {tt("Note (append)", "Nota (agregar)", "Ghi chú (nối thêm)")}
                <textarea
                  rows={3}
                  value={packForm.noteAppend}
                  onChange={(e) => setPackForm((p) => ({ ...p, noteAppend: e.target.value }))}
                />
              </label>

              <div className="btn-row">
                <button className="btn-primary" onClick={savePacking}>
                  {tt("Save", "Guardar", "Lưu")}
                </button>
                <button onClick={cancel}>{tt("Cancel", "Cancelar", "Hủy")}</button>
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
            {tt("Scan 1 QR. It must match WHITE CODE in the OR tab.", "Escanea 1 QR. Debe coincidir con WHITE CODE.", "Quét 1 QR. Phải khớp WHITE CODE trong tab OR.")}
          </div>

          {!record && (
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                placeholder={tt("Paste/scan QR here", "Pega/escanea QR aquí", "Dán/quét QR ở đây")}
                value={scannedLabel}
                onChange={(e) => setScannedLabel(e.target.value)}
              />
              <div className="btn-row">
                <button
                  className="btn-primary"
                  onClick={async () => {
                    const v = String(scannedLabel || "").trim();
                    if (!v) return;
                    await onOrUnpackingScanned(v);
                    setScannedLabel("");
                  }}
                  disabled={!sheetId || !orTab}
                >
                  {tt("Confirm Scan", "Confirmar", "Xác nhận")}
                </button>
                <button onClick={resetOperation}>{tt("Reset", "Reiniciar", "Đặt lại")}</button>
              </div>
            </div>
          )}

          {record && (
            <>
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
                    <td>
                      <b>{pickCI(record, "WHITE CODE")}</b>
                    </td>
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
                    <td>{tt("Unpacking Date", "Fecha Unpacking", "Ngày mở gói")}</td>
                    <td>{String(pickCI(record, "UNPACKING DATE") ?? "")}</td>
                  </tr>
                  <tr>
                    <td>{tt("Unpacking Quantity", "Cantidad Unpacking", "Số lượng mở gói")}</td>
                    <td>{String(pickCI(record, "UNPACKING QUANTITY") ?? "")}</td>
                  </tr>
                </tbody>
              </table>

              {!showForm ? (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button className="btn-primary" onClick={() => setShowForm(true)}>
                    {tt(unpackingAlreadyExists ? "Edit Unpacking Form" : "Unpacking", unpackingAlreadyExists ? "Editar" : "Unpacking", unpackingAlreadyExists ? "Sửa form" : "Mở gói")}
                  </button>
                  <button onClick={cancel}>{tt("Cancel", "Cancelar", "Hủy")}</button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, maxWidth: 520, marginTop: 10 }}>
                  <label className="field">
                    {tt("Unpacking Date", "Fecha de Unpacking", "Ngày mở gói")}
                    <input
                      type="date"
                      value={form.unpackingDate}
                      onChange={(e) => setForm((p) => ({ ...p, unpackingDate: e.target.value }))}
                    />
                  </label>

                  <label className="field">
                    {tt("Unpacking Quantity", "Cantidad de Unpacking", "Số lượng mở gói")}
                    <input
                      type="number"
                      value={form.unpackingQuantity}
                      onChange={(e) => setForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                    />
                  </label>

                  <label className="field">
                    {tt("Note (append)", "Nota (agregar)", "Ghi chú (nối thêm)")}
                    <textarea
                      rows={3}
                      value={form.noteAppend}
                      onChange={(e) => setForm((p) => ({ ...p, noteAppend: e.target.value }))}
                    />
                  </label>

                  <div className="btn-row">
                    <button className="btn-primary" onClick={saveUnpacking}>
                      {tt("Save", "Guardar", "Lưu")}
                    </button>
                    <button onClick={() => setShowForm(false)}>{tt("Back", "Atrás", "Quay lại")}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

