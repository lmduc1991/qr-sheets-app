// src/pages/HarvestManagementPage.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import { getItemAndHarvestByKey, appendHarvestLog, updateHarvestLogByRow } from "../api/sheetsApi";
import { getPhotoCount } from "../store/harvestStore";
import HarvestCapture from "../components/HarvestCapture";
import ExportHarvestZipButton from "../components/ExportHarvestZipButton";
import { useT } from "../i18n";

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
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
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const proxyUrl = settings?.proxyUrl || "";

  // ---------- Harvest setup (inside Harvest tab) ----------
  const [harvestUrl, setHarvestUrl] = useState(settings?.harvestUrl || "");
  const [harvestSheetName, setHarvestSheetName] = useState(settings?.harvestSheetName || "Harvesting Log");
  const harvestSpreadsheetId = extractSpreadsheetId(harvestUrl);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [setupErr, setSetupErr] = useState("");

  useEffect(() => {
    setHarvestUrl(settings?.harvestUrl || "");
    setHarvestSheetName(settings?.harvestSheetName || "Harvesting Log");
  }, [settings?.harvestUrl, settings?.harvestSheetName]);

  const saveHarvestSetup = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl)
      return setSetupErr(
        tt(
          "Missing Proxy URL. Go to Setup first.",
          "Falta la URL del proxy. Ve a Configuración primero.",
          "Thiếu Proxy URL. Vui lòng vào Cài đặt trước."
        )
      );

    if (!harvestSpreadsheetId)
      return setSetupErr(
        tt(
          "Harvest Sheet link invalid (cannot find spreadsheet ID).",
          "Enlace de Harvest inválido (no se puede encontrar el ID).",
          "Link Harvest không hợp lệ (không tìm thấy spreadsheet ID)."
        )
      );

    if (!String(harvestSheetName || "").trim())
      return setSetupErr(tt("Harvest tab name is required.", "Se requiere el nombre de la pestaña Harvest.", "Cần tên tab Harvest."));

    setSetupSaving(true);
    try {
      saveSettings({
        harvestUrl,
        harvestSpreadsheetId,
        harvestSheetName: String(harvestSheetName || "").trim(),
      });
      setSetupMsg(tt("Harvest settings saved.", "Configuración de Harvest guardada.", "Đã lưu thiết lập Harvest."));
    } catch (e) {
      setSetupErr(
        e.message ||
          tt("Failed to save Harvest settings.", "No se pudo guardar la configuración de Harvest.", "Không thể lưu thiết lập Harvest.")
      );
    } finally {
      setSetupSaving(false);
    }
  };

  // ---------- Flow state ----------
  // view: idle -> scanningItem -> detail -> harvestCreate -> harvestEdit -> processingVerify -> processingEdit
  const [view, setView] = useState("idle");

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [headers, setHeaders] = useState([]);
  const [item, setItem] = useState(null);

  const [harvestFound, setHarvestFound] = useState(false);
  const [harvestRow, setHarvestRow] = useState(null); // rowIndex in harvest sheet if exists

  const [harvestForm, setHarvestForm] = useState({
    harvestingDateInput: today(),
    harvestingDate: today(),
    numberOfShoot: "",
    shoot1Length: "",
    shoot2Length: "",
  });

  const [processingForm, setProcessingForm] = useState({
    processingDateInput: today(),
    processingDate: today(),
    numberXL: "",
    numberL: "",
    numberM: "",
    numberS: "",
    numberOR: "",
  });

  const [isSaving, setIsSaving] = useState(false);

  const scannerRef = useRef(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    const el1 = document.getElementById("harvest-item-reader");
    if (el1) el1.innerHTML = "";
    const el2 = document.getElementById("processing-label-reader");
    if (el2) el2.innerHTML = "";
  };

  const resetForNext = async (msg) => {
    await stopScanner();
    setItemKey("");
    setHeaders([]);
    setItem(null);

    setHarvestFound(false);
    setHarvestRow(null);

    setHarvestForm({
      harvestingDateInput: today(),
      harvestingDate: today(),
      numberOfShoot: "",
      shoot1Length: "",
      shoot2Length: "",
    });

    setProcessingForm({
      processingDateInput: today(),
      processingDate: today(),
      numberXL: "",
      numberL: "",
      numberM: "",
      numberS: "",
      numberOR: "",
    });

    setView("idle");
    setError("");
    setStatus(msg || tt("Ready to scan next item.", "Listo para escanear el siguiente.", "Sẵn sàng quét mã tiếp theo."));
  };

  const requireSetupOk = () => {
    if (!settings?.itemsSpreadsheetId || !settings?.itemsSheetName || !settings?.keyColumn) {
      setError(t("please_go_setup_first"));
      return false;
    }
    if (!harvestSpreadsheetId || !String(harvestSheetName || "").trim()) {
      setError(
        tt(
          "Harvest log not set. Open Harvest Log Sheet Setup first.",
          "Harvest log no configurado. Abre Configuración primero.",
          "Chưa thiết lập Harvest log. Vui lòng mở Thiết lập trước."
        )
      );
      return false;
    }
    return true;
  };

  const loadItemAndHarvest = async (key) => {
    setError("");
    setStatus(t("status_loading_item"));

    if (!requireSetupOk()) {
      setStatus("");
      return;
    }

    try {
      // IMPORTANT FIX:
      // sheetsApi.getItemAndHarvestByKey expects a STRING KEY, not an object.
      const r = await getItemAndHarvestByKey(key);

      setHeaders(r.itemHeaders || []);
      if (!r.itemFound) {
        setStatus("");
        setError(`${t("err_item_not_found_in")} ${settings.itemsSheetName}.`);
        return;
      }

      setItemKey(String(key || "").trim());
      setItem(r.item);
      setStatus(t("status_item_loaded"));

      if (r.harvestFound) {
        setHarvestFound(true);
        setHarvestRow(r.harvestRow ?? null);

        const h = r.harvest || {};
        setHarvestForm((p) => ({
          ...p,
          harvestingDateInput: h.harvestingDateInput || p.harvestingDateInput,
          harvestingDate: h.harvestingDate || p.harvestingDate,
          numberOfShoot: h.numberOfShoot || "",
          shoot1Length: h.shoot1Length || "",
          shoot2Length: h.shoot2Length || "",
        }));

        setProcessingForm((p) => ({
          ...p,
          processingDateInput: h.processingDateInput || p.processingDateInput,
          processingDate: h.processingDate || p.processingDate,
          numberXL: h.numberXL || "",
          numberL: h.numberL || "",
          numberM: h.numberM || "",
          numberS: h.numberS || "",
          numberOR: h.numberOR || "",
        }));
      } else {
        setHarvestFound(false);
        setHarvestRow(null);
      }

      setView("detail");
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_load_item"));
    }
  };

  const startItemScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    const el = document.getElementById("harvest-item-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      "harvest-item-reader",
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const key = String(decodedText || "").trim();
        if (!key) return;
        await stopScanner();
        await loadItemAndHarvest(key);
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const startProcessingLabelScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    const el = document.getElementById("processing-label-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      "processing-label-reader",
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const labelKey = String(decodedText || "").trim();
        if (!labelKey) return;

        if (labelKey !== String(itemKey || "").trim()) {
          alert(t("qr_not_match_scan_another"));
          return;
        }

        await stopScanner();
        setView("processingEdit");
        setStatus("");
        setError("");
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const saveHarvestCreate = async () => {
    setError("");
    setStatus(t("status_saving"));

    if (!itemKey) return;
    if (harvestFound) {
      setStatus("");
      setError(tt("Harvest record already exists.", "El registro de cosecha ya existe.", "Dữ liệu thu hoạch đã tồn tại."));
      return;
    }

    setIsSaving(true);
    try {
      const photoCount = getPhotoCount(itemKey);

      await appendHarvestLog({
        itemKey,
        harvestingDateInput: harvestForm.harvestingDateInput,
        harvestingDate: harvestForm.harvestingDate,
        numberOfShoot: harvestForm.numberOfShoot,
        shoot1Length: harvestForm.shoot1Length,
        shoot2Length: harvestForm.shoot2Length,
        photoCount,
      });

      await resetForNext(
        tt("Harvest saved. Ready to scan next item.", "Cosecha guardada. Listo para el siguiente.", "Đã lưu thu hoạch. Sẵn sàng quét mã tiếp theo.")
      );
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveHarvestEdit = async () => {
    setError("");
    setStatus(t("status_saving"));

    if (!itemKey) return;
    if (!harvestFound || harvestRow == null) {
      setStatus("");
      setError(tt("No harvest record to edit.", "No hay registro de cosecha para editar.", "Không có dữ liệu thu hoạch để sửa."));
      return;
    }

    setIsSaving(true);
    try {
      const photoCount = getPhotoCount(itemKey);

      await updateHarvestLogByRow({
        rowIndex: harvestRow,
        harvestingDateInput: harvestForm.harvestingDateInput,
        harvestingDate: harvestForm.harvestingDate,
        numberOfShoot: harvestForm.numberOfShoot,
        shoot1Length: harvestForm.shoot1Length,
        shoot2Length: harvestForm.shoot2Length,
        photoCount,
      });

      await resetForNext(
        tt("Harvest updated. Ready to scan next item.", "Cosecha actualizada. Listo para el siguiente.", "Đã cập nhật thu hoạch. Sẵn sàng quét mã tiếp theo.")
      );
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveProcessing = async () => {
    setError("");
    setStatus(t("status_saving"));

    if (!itemKey) return;
    if (!harvestFound || harvestRow == null) {
      setStatus("");
      setError(tt("No harvest record to update Processing.", "No hay registro para actualizar Procesamiento.", "Không có dữ liệu để cập nhật xử lý."));
      return;
    }

    setIsSaving(true);
    try {
      const photoCount = getPhotoCount(itemKey);

      await updateHarvestLogByRow({
        rowIndex: harvestRow,
        processingDateInput: processingForm.processingDateInput,
        processingDate: processingForm.processingDate,
        numberXL: processingForm.numberXL,
        numberL: processingForm.numberL,
        numberM: processingForm.numberM,
        numberS: processingForm.numberS,
        numberOR: processingForm.numberOR,
        photoCount,
      });

      await resetForNext(
        tt("Processing saved. Ready to scan next item.", "Procesamiento guardado. Listo para el siguiente.", "Đã lưu xử lý. Sẵn sàng quét mã tiếp theo.")
      );
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  const canHarvestCreate = item && !harvestFound;
  const canHarvestEdit = item && harvestFound;
  const canProcessing = item && harvestFound;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h2>{t("tab_harvest")}</h2>

      {/* Harvest setup card */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>
            {tt("Harvest Log Sheet Setup", "Configuración de Harvest Log", "Thiết lập Harvest Log")}
          </div>
          <button onClick={() => setSetupOpen((v) => !v)}>{setupOpen ? t("close") : t("storage_settings")}</button>
        </div>

        {setupOpen && (
          <div style={{ marginTop: 12 }}>
            {setupErr && <div className="alert alert-error">{setupErr}</div>}
            {setupMsg && <div className="alert alert-ok">{setupMsg}</div>}

            <label className="field">
              {t("google_sheet_link")}
              <input
                value={harvestUrl}
                onChange={(e) => setHarvestUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
            </label>

            <label className="field">
              {t("tab_name")}
              <input value={harvestSheetName} onChange={(e) => setHarvestSheetName(e.target.value)} />
            </label>

            <button className="primary" onClick={saveHarvestSetup} disabled={setupSaving}>
              {setupSaving ? t("saving") : tt("Save Harvest Setup", "Guardar configuración de Harvest", "Lưu thiết lập Harvest")}
            </button>
          </div>
        )}
      </div>

      {(status || error) && (
        <div className="card" style={{ marginTop: 10 }}>
          {status && <div className="alert">{status}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      )}

      {/* Idle */}
      {view === "idle" && (
        <div className="card">
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            {tt("Ready. Click Start Scanning.", "Listo. Pulsa Iniciar escaneo.", "Sẵn sàng. Bấm Bắt đầu quét.")}
          </div>

          <button
            className="primary"
            style={{ marginTop: 10 }}
            onClick={async () => {
              setError("");
              setStatus("");
              setView("scanningItem");
              await stopScanner();
              setTimeout(() => startItemScanner(), 150);
            }}
          >
            {tt("Start Scanning", "Iniciar escaneo", "Bắt đầu quét")}
          </button>
        </div>
      )}

      {/* Scanning Item */}
      {view === "scanningItem" && (
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            {tt("Scan Item QR (Key Column:", "Escanea el QR del artículo (columna clave:", "Quét QR của item (cột khóa:")}{" "}
            {settings?.keyColumn || "KEY"}
            {")"}
          </div>

          <div id="harvest-item-reader" />

          <button
            style={{ marginTop: 10 }}
            onClick={async () => {
              await stopScanner();
              setView("idle");
              setStatus("");
              setError("");
            }}
          >
            {t("stop")}
          </button>
        </div>
      )}

      {/* Detail + Options */}
      {view === "detail" && item && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div>
                <strong>{tt("Scanned Key:", "Clave escaneada:", "Mã đã quét:")}</strong> {itemKey}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                {tt("Item:", "Artículo:", "Item:")} {settings?.itemsSheetName || ""}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                {harvestFound
                  ? tt("Harvest record found.", "Registro de cosecha encontrado.", "Tìm thấy dữ liệu thu hoạch.")
                  : tt("No harvest record yet.", "Aún no hay registro de cosecha.", "Chưa có dữ liệu thu hoạch.")}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={async () => {
                  await resetForNext(tt("Ready to scan next item.", "Listo para el siguiente.", "Sẵn sàng quét mã tiếp theo."));
                }}
              >
                {tt("Scan Another", "Escanear otro", "Quét mã khác")}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>{t("item_details")}</h4>
            <PrettyDetails item={item} preferredOrder={headers} />
          </div>

          {/* Required Options */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className={canHarvestCreate ? "primary" : ""}
              disabled={!canHarvestCreate}
              title={harvestFound ? "Disabled because harvest record exists." : ""}
              onClick={() => {
                setError("");
                setStatus("");
                setView("harvestCreate");
              }}
            >
              {tt("Harvest", "Cosecha", "Thu hoạch")}
            </button>

            <button
              className={canHarvestEdit ? "primary" : ""}
              disabled={!canHarvestEdit}
              title={!harvestFound ? "Disabled because no harvest record exists yet." : ""}
              onClick={() => {
                setError("");
                setStatus("");
                setView("harvestEdit");
              }}
            >
              {tt("Harvest Form", "Formulario de cosecha", "Form thu hoạch")}
            </button>

            <button
              className={canProcessing ? "primary" : ""}
              disabled={!canProcessing}
              title={!harvestFound ? "Disabled because no harvest record exists yet." : ""}
              onClick={async () => {
                setError("");
                setStatus("");
                setView("processingVerify");
                await stopScanner();
                setTimeout(() => startProcessingLabelScanner(), 150);
              }}
            >
              {tt("Processing", "Procesamiento", "Xử lý")}
            </button>
          </div>
        </div>
      )}

      {/* Harvest (create) */}
      {view === "harvestCreate" && item && (
        <div className="card" style={{ background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>{tt("Harvest", "Cosecha", "Thu hoạch")}</h3>
            <button onClick={() => setView("detail")}>{t("back")}</button>
          </div>

          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">
              {tt("Harvest Date", "Fecha de cosecha", "Ngày thu hoạch")}
              <input
                type="date"
                value={harvestForm.harvestingDate}
                onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDate: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Number of Shoots", "Número de brotes", "Số chồi")}
              <input
                value={harvestForm.numberOfShoot}
                onChange={(e) => setHarvestForm((p) => ({ ...p, numberOfShoot: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Shoot 1 length", "Longitud del brote 1", "Chiều dài chồi 1")}
              <input
                value={harvestForm.shoot1Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot1Length: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Shoot 2 length", "Longitud del brote 2", "Chiều dài chồi 2")}
              <input
                value={harvestForm.shoot2Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot2Length: e.target.value }))}
                disabled={isSaving}
              />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <HarvestCapture itemId={itemKey} />
            <ExportHarvestZipButton />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={saveHarvestCreate} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </button>
            <button onClick={() => setView("detail")} disabled={isSaving}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Harvest Form (edit existing) */}
      {view === "harvestEdit" && item && (
        <div className="card" style={{ background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>{tt("Harvest Form", "Formulario de cosecha", "Form thu hoạch")}</h3>
            <button onClick={() => setView("detail")}>{t("back")}</button>
          </div>

          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">
              {tt("Harvest Date", "Fecha de cosecha", "Ngày thu hoạch")}
              <input
                type="date"
                value={harvestForm.harvestingDate}
                onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDate: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Number of Shoots", "Número de brotes", "Số chồi")}
              <input
                value={harvestForm.numberOfShoot}
                onChange={(e) => setHarvestForm((p) => ({ ...p, numberOfShoot: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Shoot 1 length", "Longitud del brote 1", "Chiều dài chồi 1")}
              <input
                value={harvestForm.shoot1Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot1Length: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              {tt("Shoot 2 length", "Longitud del brote 2", "Chiều dài chồi 2")}
              <input
                value={harvestForm.shoot2Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot2Length: e.target.value }))}
                disabled={isSaving}
              />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <HarvestCapture itemId={itemKey} />
            <ExportHarvestZipButton />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={saveHarvestEdit} disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </button>
            <button onClick={() => setView("detail")} disabled={isSaving}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Processing verify (scan label) */}
      {view === "processingVerify" && item && (
        <div className="card" style={{ background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>{tt("Processing", "Procesamiento", "Xử lý")}</h3>
            <button
              onClick={async () => {
                await stopScanner();
                setView("detail");
              }}
            >
              {t("back")}
            </button>
          </div>

          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8 }}>
            {tt(
              "Scan the Processing label to confirm it matches this item.",
              "Escanea la etiqueta de procesamiento para confirmar que coincide.",
              "Quét nhãn xử lý để xác nhận khớp với item này."
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            <div id="processing-label-reader" />
          </div>
        </div>
      )}

      {/* Processing edit form */}
      {view === "processingEdit" && item && (
        <div className="card" style={{ background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>{tt("Processing", "Procesamiento", "Xử lý")}</h3>
            <button onClick={() => setView("detail")}>{t("back")}</button>
          </div>

          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">
              {tt("Processing Date", "Fecha de procesamiento", "Ngày xử lý")}
              <input
                type="date"
                value={processingForm.processingDate}
                onChange={(e) => setProcessingForm((p) => ({ ...p, processingDate: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              XL
              <input
                value={processingForm.numberXL}
                onChange={(e) => setProcessingForm((p) => ({ ...p, numberXL: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              L
              <input
                value={processingForm.numberL}
                onChange={(e) => setProcessingForm((p) => ({ ...p, numberL: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              M
              <input
                value={processingForm.numberM}
                onChange={(e) => setProcessingForm((p) => ({ ...p, numberM: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              S
              <input
                value={processingForm.numberS}
                onChange={(e) => setProcessingForm((p) => ({ ...p, numberS: e.target.value }))}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              OR
              <input
                value={processingForm.numberOR}
                onChange={(e) => setProcessingForm((p) => ({ ...p, numberOR: e.target.value }))}
                disabled={isSaving}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="primary" onClick={saveProcessing} disabled={isSaving}>
              {isSaving ? t("saving") : tt("Save Processing", "Guardar procesamiento", "Lưu xử lý")}
            </button>

            <button onClick={() => setView("detail")} disabled={isSaving}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
