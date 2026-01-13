import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, onSettingsChange, saveSettings } from "../store/settingsStore";
import { getSheetTabs, getUnpackingRecordByLabel, updateUnpackingByRow } from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function isBlank(v) {
  return v == null || String(v).trim() === "";
}

function pickCI(obj, ...names) {
  const keys = Object.keys(obj || {});
  const map = new Map(keys.map((k) => [String(k).trim().toLowerCase(), k]));
  for (const n of names) {
    const hit = map.get(String(n).trim().toLowerCase());
    if (hit) return obj[hit];
  }
  return "";
}

function RecordSummary({ record }) {
  if (!record) return null;

  const whiteCode = pickCI(record, "WHITE CODE", "White Code", "white code");
  const packingDate = pickCI(record, "PACKING DATE", "Packing Date");
  const packingQty = pickCI(record, "PACKING QUANTITY", "Packing Quantity");
  const unpackingDate = pickCI(record, "UNPACKING DATE", "Unpacking Date");
  const unpackingQty = pickCI(record, "UNPACKING QUANTITY", "Unpacking Quantity");

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>White Code</div>
        <div>{String(whiteCode || "")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Packing Date</div>
        <div>{String(packingDate || "")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Packing Qty</div>
        <div>{String(packingQty || "")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Unpacking Date</div>
        <div>{String(unpackingDate || "")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Unpacking Qty</div>
        <div>{String(unpackingQty || "")}</div>
      </div>
    </div>
  );
}

export default function PackingUnpackingManagementPage() {
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  const MODES = [
    { id: "or-pack", label: tt("OR-Packing", "OR-Empaque", "OR-Đóng gói"), needs: "or" },
    { id: "or-unpack", label: tt("OR-Unpacking", "OR-Desempaque", "OR-Mở gói"), needs: "or" },
    { id: "graft-pack", label: tt("Grafting-Packing", "Injerto-Empaque", "Ghép-Đóng gói"), needs: "grafting" },
    { id: "graft-unpack", label: tt("Grafting-Unpacking", "Injerto-Desempaque", "Ghép-Mở gói"), needs: "grafting" },
  ];

  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const base = useMemo(() => loadSettings(), []);
  const proxyUrl = settings?.proxyUrl || base?.proxyUrl || "";

  // Setup
  const [packingUrl, setPackingUrl] = useState(base?.packingUrl || "");
  const [orSheetName, setOrSheetName] = useState(base?.packingOrSheetName || "");
  const [graftingSheetName, setGraftingSheetName] = useState(base?.packingGraftingSheetName || "");
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const packingSpreadsheetId = extractSpreadsheetId(packingUrl);

  // OR-Unpacking operation state
  const [activeMode, setActiveMode] = useState(null);
  const [opStatus, setOpStatus] = useState("");
  const [opError, setOpError] = useState("");
  const [scannedLabel, setScannedLabel] = useState("");
  const [record, setRecord] = useState(null);
  const [recordRow, setRecordRow] = useState(null);
  const [matchedColumn, setMatchedColumn] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });

  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setIsScanning(false);
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
    await stopScanner();
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTabs = async () => {
    setError("");
    setMsg("");

    if (!proxyUrl.trim()) return setError(t("proxy_missing_go_setup"));
    if (!packingSpreadsheetId) return setError(t("packing_sheet_invalid"));

    setLoadingTabs(true);
    try {
      const tbs = await getSheetTabs(packingSpreadsheetId);
      setTabs(tbs);
      setMsg(t("tabs_loaded_choose_or_grafting"));
    } catch (e) {
      setError(e.message || tt("Failed to load tabs.", "No se pudieron cargar las pestañas.", "Không thể tải tab."));
    } finally {
      setLoadingTabs(false);
    }
  };

  const savePackingSetup = () => {
    setError("");
    setMsg("");

    if (!packingSpreadsheetId) return setError(t("packing_sheet_invalid"));

    saveSettings({
      packingUrl,
      packingSpreadsheetId,
      packingOrSheetName: String(orSheetName || "").trim(),
      packingGraftingSheetName: String(graftingSheetName || "").trim(),
    });

    setMsg(t("packing_setup_saved"));
  };

  const ensureTabForMode = (needs) => {
    if (!packingSpreadsheetId) {
      alert(
        tt(
          "Packing Sheet is not set. Paste the sheet link and Save Packing Setup first.",
          "No está configurada la hoja de Packing. Pega el enlace y guarda primero.",
          "Chưa thiết lập Packing Sheet. Dán link và lưu trước."
        )
      );
      return false;
    }
    if (needs === "or" && !String(orSheetName || "").trim()) {
      alert(
        tt(
          "OR tab is not set. Choose the OR tab and Save Packing Setup.",
          "No está configurada la pestaña OR. Elígela y guarda.",
          "Chưa thiết lập tab OR. Chọn tab rồi lưu."
        )
      );
      return false;
    }
    if (needs === "grafting" && !String(graftingSheetName || "").trim()) {
      alert(
        tt(
          "GRAFTING tab is not set. Choose the GRAFTING tab and Save Packing Setup.",
          "No está configurada la pestaña GRAFTING. Elígela y guarda.",
          "Chưa thiết lập tab GRAFTING. Chọn tab rồi lưu."
        )
      );
      return false;
    }
    return true;
  };

  const startMode = async (m) => {
    if (!ensureTabForMode(m.needs)) return;
    await resetOperation();
    setActiveMode(m);

    if (m.id === "or-unpack") {
      setOpStatus(tt("Ready. Scan 1 label QR (White Code).", "Listo. Escanea 1 QR (White Code).", "Sẵn sàng. Quét 1 QR (White Code)."));
      return;
    }

    alert(
      tt(
        `OK. Next step: implement scanning + forms for "${m.label}".`,
        `OK. Siguiente paso: implementar escaneo y formularios para "${m.label}".`,
        `OK. Bước tiếp theo: triển khai quét và form cho "${m.label}".`
      )
    );
  };

  const startOrUnpackingScan = () => {
    if (!activeMode || activeMode.id !== "or-unpack") return;

    setOpError("");
    setOpStatus(tt("Scanning...", "Escaneando...", "Đang quét..."));

    const el = document.getElementById("packing-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));

    const scanner = new Html5QrcodeScanner(
      "packing-reader",
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const code = String(decodedText || "").trim();
        if (!code) return;
        await stopScanner();
        await onOrUnpackingScanned(code);
      },
      () => {}
    );

    scannerRef.current = scanner;
    setIsScanning(true);
  };

  const onOrUnpackingScanned = async (label) => {
    setOpError("");
    setOpStatus(tt("Looking up record...", "Buscando registro...", "Đang tìm bản ghi..."));
    setScannedLabel(label);
    setRecord(null);
    setRecordRow(null);
    setMatchedColumn(null);
    setShowForm(false);

    try {
      const r = await getUnpackingRecordByLabel({ needs: "or", labelValue: label });

      if (!r?.found) {
        setOpStatus("");
        setOpError(
          tt(
            `Record not found for: ${label}. Operation cancelled.`,
            `No se encontró registro para: ${label}. Operación cancelada.`,
            `Không tìm thấy bản ghi cho: ${label}. Đã hủy thao tác.`
          )
        );
        return;
      }

      setRecord(r.record || null);
      setRecordRow(r.rowIndex || null);
      setMatchedColumn(r.matchedColumn || null);

      const unpackDate = pickCI(r.record || {}, "UNPACKING DATE", "Unpacking Date");
      const unpackQty = pickCI(r.record || {}, "UNPACKING QUANTITY", "Unpacking Quantity");

      if (!isBlank(unpackDate) || !isBlank(unpackQty)) {
        setOpStatus(tt("Record loaded. Unpacking already exists.", "Registro cargado. Ya existe desempaque.", "Đã tải bản ghi. Đã có mở gói."));
      } else {
        setOpStatus(tt("Record loaded. Ready to unpack.", "Registro cargado. Listo para desempacar.", "Đã tải bản ghi. Sẵn sàng mở gói."));
      }
    } catch (e) {
      setOpStatus("");
      setOpError(e.message || tt("Lookup failed.", "Falló la búsqueda.", "Tìm kiếm thất bại."));
    }
  };

  const openUnpackingForm = () => {
    setForm({ unpackingDate: "", unpackingQuantity: "", noteAppend: "" });
    setShowForm(true);
  };

  const saveUnpacking = async () => {
    setOpError("");
    if (!recordRow) {
      setOpError(tt("Missing row index. Cancel and scan again.", "Falta el índice de fila. Cancela y escanea de nuevo.", "Thiếu số dòng. Hủy và quét lại."));
      return;
    }

    const unpackingDate = String(form.unpackingDate || "").trim();
    const unpackingQuantity = String(form.unpackingQuantity || "").trim();
    const noteAppend = String(form.noteAppend || "").trim();

    if (!unpackingDate && !unpackingQuantity && !noteAppend) {
      setOpError(tt("Enter at least one field.", "Ingresa al menos un campo.", "Nhập ít nhất 1 trường."));
      return;
    }

    setOpStatus(tt("Saving...", "Guardando...", "Đang lưu..."));

    try {
      await updateUnpackingByRow({
        needs: "or",
        rowIndex: Number(recordRow),
        unpackingDate,
        unpackingQuantity,
        noteAppend,
      });

      setOpStatus(tt("Saved. Ready for next scan.", "Guardado. Listo para el próximo escaneo.", "Đã lưu. Sẵn sàng quét tiếp."));
      await resetOperation();
    } catch (e) {
      setOpStatus("");
      setOpError(e.message || tt("Save failed.", "Falló el guardado.", "Lưu thất bại."));
    }
  };

  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  const unpackingAlreadyExists = (() => {
    const d = pickCI(record || {}, "UNPACKING DATE", "Unpacking Date");
    const q = pickCI(record || {}, "UNPACKING QUANTITY", "Unpacking Quantity");
    return !isBlank(d) || !isBlank(q);
  })();

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>{t("tab_packing")}</h2>

      {(msg || error) && (
        <div className="card" style={{ marginBottom: 10 }}>
          {error && <div className="alert alert-error">{error}</div>}
          {msg && <div className="alert alert-ok">{msg}</div>}
        </div>
      )}

      <div className="card">
        <h3>{t("packing_setup_title")}</h3>

        <label className="field">
          {t("packing_sheet_link")}
          <input
            value={packingUrl}
            onChange={(e) => setPackingUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={loadTabs} disabled={loadingTabs || !packingSpreadsheetId}>
            {loadingTabs ? t("loading") : t("load_tabs")}
          </button>
          <button onClick={savePackingSetup} disabled={!packingSpreadsheetId}>
            {t("save_packing_setup")}
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="field">
            {t("or_tab_label")}
            {tabs.length ? (
              <select value={orSheetName} onChange={(e) => setOrSheetName(e.target.value)}>
                <option value="">{t("not_set")}</option>
                {tabs.map((tb) => (
                  <option key={tb} value={tb}>
                    {tb}
                  </option>
                ))}
              </select>
            ) : (
              <input value={orSheetName} onChange={(e) => setOrSheetName(e.target.value)} placeholder="OR" />
            )}
          </label>

          <label className="field">
            {t("grafting_tab_label")}
            {tabs.length ? (
              <select value={graftingSheetName} onChange={(e) => setGraftingSheetName(e.target.value)}>
                <option value="">{t("not_set")}</option>
                {tabs.map((tb) => (
                  <option key={tb} value={tb}>
                    {tb}
                  </option>
                ))}
              </select>
            ) : (
              <input value={graftingSheetName} onChange={(e) => setGraftingSheetName(e.target.value)} placeholder="GRAFTING" />
            )}
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>{t("optional_note")}</div>
      </div>

      <div className="card">
        <h3>{t("choose_operation")}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => startMode(m)} className={activeMode?.id === m.id ? "primary" : ""}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {activeMode?.id === "or-unpack" && (
        <div className="card">
          <h3>{tt("OR-Unpacking", "OR-Desempaque", "OR-Mở gói")}</h3>

          {(opStatus || opError) && (
            <div style={{ marginBottom: 10 }}>
              {opStatus && <div className="alert">{opStatus}</div>}
              {opError && <div className="alert alert-error">{opError}</div>}
            </div>
          )}

          {!record && (
            <>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
                {tt(
                  "Scan 1 label QR. It must match WHITE CODE in the OR tab.",
                  "Escanea 1 QR. Debe coincidir con WHITE CODE en la pestaña OR.",
                  "Quét 1 QR. Phải khớp WHITE CODE trong tab OR."
                )}
              </div>

              {!isScanning ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="primary" onClick={startOrUnpackingScan}>
                    {tt("Start Scanning", "Iniciar escaneo", "Bắt đầu quét")}
                  </button>
                  <button onClick={resetOperation}>{tt("Cancel", "Cancelar", "Hủy")}</button>
                </div>
              ) : (
                <>
                  <div id="packing-reader" />
                  <button style={{ marginTop: 10 }} onClick={stopScanner}>
                    {tt("Stop", "Detener", "Dừng")}
                  </button>
                </>
              )}
            </>
          )}

          {record && !showForm && (
            <>
              <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.85 }}>
                {tt("Scanned:", "Escaneado:", "Đã quét:")} <strong>{scannedLabel}</strong>
                {matchedColumn ? (
                  <span style={{ marginLeft: 8 }}>
                    {tt("(matched column:", "(columna coincidente:", "(cột khớp:")} <strong>{matchedColumn}</strong>)
                  </span>
                ) : null}
              </div>

              <RecordSummary record={record} />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                {!unpackingAlreadyExists ? (
                  <button className="primary" onClick={openUnpackingForm}>
                    {tt("Unpacking", "Desempaque", "Mở gói")}
                  </button>
                ) : (
                  <button className="primary" onClick={openUnpackingForm}>
                    {tt("Edit Unpacking Form", "Editar desempaque", "Sửa form mở gói")}
                  </button>
                )}

                <button onClick={resetOperation}>{tt("Scan Another", "Escanear otro", "Quét mã khác")}</button>
              </div>
            </>
          )}

          {record && showForm && (
            <>
              <div style={{ marginTop: 10, marginBottom: 8, fontWeight: 800 }}>
                {tt("Unpacking Form", "Formulario de desempaque", "Form mở gói")}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label className="field">
                  {tt("Unpacking Date", "Fecha de desempaque", "Ngày mở gói")}
                  <input
                    type="date"
                    value={form.unpackingDate}
                    onChange={(e) => setForm((p) => ({ ...p, unpackingDate: e.target.value }))}
                  />
                </label>

                <label className="field">
                  {tt("Unpacking Quantity", "Cantidad de desempaque", "Số lượng mở gói")}
                  <input
                    type="number"
                    value={form.unpackingQuantity}
                    onChange={(e) => setForm((p) => ({ ...p, unpackingQuantity: e.target.value }))}
                    placeholder="0"
                  />
                </label>

                <label className="field">
                  {tt("Note (append)", "Nota (agregar)", "Ghi chú (nối thêm)")}
                  <textarea
                    value={form.noteAppend}
                    onChange={(e) => setForm((p) => ({ ...p, noteAppend: e.target.value }))}
                    placeholder={tt("This will append to existing notes.", "Esto se agregará a las notas existentes.", "Sẽ nối vào ghi chú hiện có.")}
                    rows={4}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveUnpacking}>
                  {tt("Save", "Guardar", "Lưu")}
                </button>
                <button onClick={() => setShowForm(false)}>{tt("Back", "Atrás", "Quay lại")}</button>
                <button onClick={resetOperation}>{tt("Cancel", "Cancelar", "Hủy")}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
