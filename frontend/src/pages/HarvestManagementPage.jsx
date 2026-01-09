import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import {
  getItemAndHarvestByKey,
  appendHarvestLog,
  updateHarvestLogByRow,
} from "../api/sheetsApi";
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

  // Harvest setup
  const [harvestUrl, setHarvestUrl] = useState(settings?.harvestUrl || "");
  const [harvestSheetName, setHarvestSheetName] = useState(
    settings?.harvestSheetName || "Harvesting Log"
  );
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
      return setSetupErr(
        tt(
          "Harvest tab name is required.",
          "Se requiere el nombre de la pestaña Harvest.",
          "Cần tên tab Harvest."
        )
      );

    setSetupSaving(true);
    try {
      saveSettings({
        harvestUrl,
        harvestSpreadsheetId,
        harvestSheetName: String(harvestSheetName || "").trim(),
      });
      setSetupMsg(
        tt(
          "Harvest settings saved.",
          "Configuración de Harvest guardada.",
          "Đã lưu thiết lập Harvest."
        )
      );
    } catch (e) {
      setSetupErr(
        e.message ||
          tt(
            "Failed to save Harvest settings.",
            "No se pudo guardar la configuración de Harvest.",
            "Không thể lưu thiết lập Harvest."
          )
      );
    } finally {
      setSetupSaving(false);
    }
  };

  // Scanner + flow state
  const [step, setStep] = useState("idle"); // idle | scanning | viewItem | verifyProcessing
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [headers, setHeaders] = useState([]);
  const [item, setItem] = useState(null);

  const [harvestRow, setHarvestRow] = useState(null); // row index in sheet if exists
  const [harvestFormMode, setHarvestFormMode] = useState("create"); // create | view | edit
  const [processingFormMode, setProcessingFormMode] = useState("view"); // view | edit

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

  const resetStateForNewScan = () => {
    setItemKey("");
    setHeaders([]);
    setItem(null);
    setHarvestRow(null);
    setHarvestFormMode("create");
    setProcessingFormMode("view");
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

  const returnToIdleReady = async (msg) => {
    await stopScanner();
    resetStateForNewScan();
    setStep("idle");
    setError("");
    setStatus(msg || tt("Ready to scan next item.", "Listo para escanear el siguiente.", "Sẵn sàng quét mã tiếp theo."));
  };

  const loadItemAndHarvest = async (key) => {
    setError("");
    setStatus(t("status_loading_item"));

    if (!settings?.itemsSpreadsheetId || !settings?.itemsSheetName || !settings?.keyColumn) {
      setStatus("");
      setError(t("please_go_setup_first"));
      return;
    }
    if (!harvestSpreadsheetId || !String(harvestSheetName || "").trim()) {
      setStatus("");
      setError(tt("Harvest log not set. Open Harvest Log Sheet Setup first.", "Harvest log no configurado. Abre Configuración primero.", "Chưa thiết lập Harvest log. Vui lòng mở Thiết lập trước."));
      return;
    }

    try {
      const r = await getItemAndHarvestByKey({
        itemKey: key,
        itemSpreadsheetId: settings.itemsSpreadsheetId,
        itemSheetName: settings.itemsSheetName,
        itemKeyColumn: settings.keyColumn,

        harvestSpreadsheetId,
        harvestSheetName: String(harvestSheetName || "").trim(),
      });

      setHeaders(r.itemHeaders || []);
      if (!r.itemFound) {
        setStatus("");
        setError(`${t("err_item_not_found_in")} ${settings.itemsSheetName}.`);
        return;
      }

      setItemKey(key);
      setItem(r.item);
      setStatus(t("status_item_loaded"));

      if (r.harvestFound) {
        setHarvestRow(r.harvestRow);
        // Load existing harvest + processing values if present
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
        setHarvestFormMode("view");
        setProcessingFormMode("view");
      } else {
        setHarvestRow(null);
        setHarvestFormMode("create");
        setProcessingFormMode("view");
      }

      setStep("viewItem");
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_load_item"));
    }
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
        setStep("viewItem");
        setStatus("");
        setError("");
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const saveHarvest = async () => {
    setError("");
    setStatus(t("status_saving"));

    if (!itemKey) return;

    setIsSaving(true);
    try {
      const photoCount = getPhotoCount(itemKey);

      if (harvestRow != null) {
        await updateHarvestLogByRow({
          rowIndex: harvestRow,
          harvestingDateInput: harvestForm.harvestingDateInput,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });
      } else {
        await appendHarvestLog({
          itemKey,
          harvestingDateInput: harvestForm.harvestingDateInput,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });
      }

      await returnToIdleReady(
        tt(
          "Harvest saved. Ready to scan next item.",
          "Cosecha guardada. Listo para el siguiente.",
          "Đã lưu thu hoạch. Sẵn sàng quét mã tiếp theo."
        )
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

    setIsSaving(true);
    try {
      const photoCount = getPhotoCount(itemKey);

      if (harvestRow != null) {
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
      } else {
        await appendHarvestLog({
          itemKey,
          processingDateInput: processingForm.processingDateInput,
          processingDate: processingForm.processingDate,
          numberXL: processingForm.numberXL,
          numberL: processingForm.numberL,
          numberM: processingForm.numberM,
          numberS: processingForm.numberS,
          numberOR: processingForm.numberOR,
          photoCount,
        });
      }

      await returnToIdleReady(
        tt(
          "Processing saved. Ready to scan next item.",
          "Procesamiento guardado. Listo para el siguiente.",
          "Đã lưu xử lý. Sẵn sàng quét mã tiếp theo."
        )
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

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h2>{t("tab_harvest")}</h2>

      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>{tt("Harvest Log Sheet Setup", "Configuración de Harvest Log", "Thiết lập Harvest Log")}</div>
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

      {step === "idle" && (
        <div className="card">
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            {tt("Ready. Click Start Scanning.", "Listo. Pulsa Iniciar escaneo.", "Sẵn sàng. Bấm Bắt đầu quét.")}
          </div>

          <button
            className="primary"
            style={{ marginTop: 10 }}
            onClick={async () => {
              resetStateForNewScan();
              setStep("scanning");
              setStatus("");
              setError("");
              await stopScanner();
              setTimeout(() => startItemScanner(), 150);
            }}
          >
            {tt("Start Scanning", "Iniciar escaneo", "Bắt đầu quét")}
          </button>
        </div>
      )}

      {step === "scanning" && (
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            {tt("Scan Item QR (Key Column:", "Escanea el QR del artículo (columna clave:", "Quét QR của item (cột khóa:")}{" "}
            {settings?.keyColumn || "KEY"}) )
          </div>

          <div id="harvest-item-reader" />

          <button
            style={{ marginTop: 10 }}
            onClick={async () => {
              await stopScanner();
              setStep("idle");
              setStatus("");
              setError("");
              resetStateForNewScan();
            }}
          >
            {t("stop")}
          </button>
        </div>
      )}

      {step === "viewItem" && item && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div>
                <strong>{tt("Scanned Key:", "Clave escaneada:", "Mã đã quét:")}</strong> {itemKey}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                {tt("Item:", "Artículo:", "Item:")} {settings?.itemsSheetName || ""}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={async () => {
                  await returnToIdleReady(tt("Ready to scan next item.", "Listo para el siguiente.", "Sẵn sàng quét mã tiếp theo."));
                }}
              >
                {tt("Start Scanning", "Iniciar escaneo", "Bắt đầu quét")}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>{t("item_details")}</h4>
            <PrettyDetails item={item} preferredOrder={headers} />
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div className="card" style={{ background: "#fafafa" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{tt("Harvest Form", "Formulario de cosecha", "Form thu hoạch")}</h3>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {harvestFormMode === "view" && (
                    <button className="primary" onClick={() => setHarvestFormMode("edit")}>
                      {t("edit")}
                    </button>
                  )}
                  {harvestFormMode === "edit" && (
                    <button onClick={() => setHarvestFormMode("view")}>{t("cancel_edit")}</button>
                  )}
                </div>
              </div>

              <div className="grid" style={{ marginTop: 10 }}>
                <label className="field">
                  {tt("Harvest Date", "Fecha de cosecha", "Ngày thu hoạch")}
                  <input
                    type="date"
                    value={harvestForm.harvestingDate}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDate: e.target.value }))}
                    disabled={harvestFormMode === "view"}
                  />
                </label>

                <label className="field">
                  {tt("Number of Shoots", "Número de brotes", "Số chồi")}
                  <input
                    value={harvestForm.numberOfShoot}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, numberOfShoot: e.target.value }))}
                    disabled={harvestFormMode === "view"}
                  />
                </label>

                <label className="field">
                  {tt("Shoot 1 length", "Longitud del brote 1", "Chiều dài chồi 1")}
                  <input
                    value={harvestForm.shoot1Length}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, shoot1Length: e.target.value }))}
                    disabled={harvestFormMode === "view"}
                  />
                </label>

                <label className="field">
                  {tt("Shoot 2 length", "Longitud del brote 2", "Chiều dài chồi 2")}
                  <input
                    value={harvestForm.shoot2Length}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, shoot2Length: e.target.value }))}
                    disabled={harvestFormMode === "view"}
                  />
                </label>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <HarvestCapture itemId={itemKey} />
                <ExportHarvestZipButton />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveHarvest} disabled={isSaving}>
                  {isSaving ? t("saving") : t("save")}
                </button>
              </div>
            </div>

            <div className="card" style={{ background: "#fafafa" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{tt("Wood Processing Form", "Formulario de procesamiento", "Form xử lý")}</h3>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {processingFormMode === "view" && (
                    <button
                      className="primary"
                      onClick={async () => {
                        await stopScanner();
                        setStep("verifyProcessing");
                        setTimeout(() => startProcessingLabelScanner(), 150);
                      }}
                    >
                      {tt("Wood Processing", "Procesamiento de madera", "Xử lý gỗ")}
                    </button>
                  )}
                </div>
              </div>

              {step === "verifyProcessing" && (
                <div style={{ marginTop: 10 }}>
                  <div id="processing-label-reader" />
                  <button style={{ marginTop: 10 }} onClick={() => setStep("viewItem")}>
                    {t("back")}
                  </button>
                </div>
              )}

              <div className="grid" style={{ marginTop: 10 }}>
                <label className="field">
                  {tt("Processing Date", "Fecha de procesamiento", "Ngày xử lý")}
                  <input
                    type="date"
                    value={processingForm.processingDate}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, processingDate: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>

                <label className="field">
                  XL
                  <input
                    value={processingForm.numberXL}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberXL: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>

                <label className="field">
                  L
                  <input
                    value={processingForm.numberL}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberL: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>

                <label className="field">
                  M
                  <input
                    value={processingForm.numberM}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberM: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>

                <label className="field">
                  S
                  <input
                    value={processingForm.numberS}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberS: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>

                <label className="field">
                  OR
                  <input
                    value={processingForm.numberOR}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberOR: e.target.value }))}
                    disabled={processingFormMode === "view"}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveProcessing} disabled={isSaving}>
                  {isSaving ? t("saving") : tt("Save Processing", "Guardar procesamiento", "Lưu xử lý")}
                </button>

                <button
                  onClick={async () => {
                    await stopScanner();
                    setStep("viewItem");
                    setStatus("");
                    setError("");
                  }}
                  disabled={isSaving}
                >
                  {t("back")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
