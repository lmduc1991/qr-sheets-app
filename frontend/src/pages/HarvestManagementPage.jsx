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

  // ---- Harvest setup (inside this page) ----
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
        tt("Missing Proxy URL. Go to Setup first.", "Falta la URL del proxy. Ve a Configuración primero.", "Thiếu Proxy URL. Vui lòng vào Cài đặt trước.")
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
        tt("Harvest tab name is required.", "Se requiere el nombre de la pestaña Harvest.", "Cần tên tab Harvest.")
      );

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
        e?.message ||
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

  // ---- Flow state ----
  // idle | scanning | viewItem | verifyHarvest | verifyProcessing
  const [step, setStep] = useState("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [headers, setHeaders] = useState([]);
  const [item, setItem] = useState(null);

  // Harvest log presence (unique by white code in your rules)
  const [harvestRow, setHarvestRow] = useState(null); // row index if found
  const [harvestFound, setHarvestFound] = useState(false);

  // User selects which operation UI to show
  // none | harvestCreate | harvestEdit | processing
  const [activeOp, setActiveOp] = useState("none");

  // Forms
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

    const ids = ["harvest-item-reader", "harvest-label-reader", "processing-label-reader"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    }
  };

  const resetStateForNewScan = () => {
    setItemKey("");
    setHeaders([]);
    setItem(null);

    setHarvestRow(null);
    setHarvestFound(false);
    setActiveOp("none");

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

  const returnToIdleReady = async (msg) => {
    await stopScanner();
    resetStateForNewScan();
    setStep("idle");
    setError("");
    setStatus(
      msg ||
        tt("Ready to scan next item.", "Listo para escanear el siguiente.", "Sẵn sàng quét mã tiếp theo.")
    );
  };

  // ---- Load item + harvest in ONE call (fast) ----
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
      setError(
        tt(
          "Harvest log not set. Open Harvest Log Sheet Setup first.",
          "Harvest log no configurado. Abre Configuración primero.",
          "Chưa thiết lập Harvest log. Vui lòng mở Thiết lập trước."
        )
      );
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
        setHarvestFound(true);
        setHarvestRow(r.harvestRow);

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
        setActiveOp("none"); // user chooses Harvest Form or Processing
      } else {
        setHarvestFound(false);
        setHarvestRow(null);
        setHarvestFormMode("create");
        setProcessingFormMode("view");
        setActiveOp("none"); // user must tap Harvest then verify label
      }

      setStep("viewItem");
    } catch (e) {
      setStatus("");
      setError(e?.message || t("err_failed_load_item"));
    }
  };

  // ---- Scanners ----
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

  const startHarvestLabelScanner = () => {
    if (scannerRef.current) return;

    setError("");
    setStatus("");

    const el = document.getElementById("harvest-label-reader");
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      "harvest-label-reader",
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
        setError("");
        setStatus("");
        setActiveOp("harvestCreate");
        setHarvestFormMode("create");
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
        setStep("viewItem");
        setStatus("");
        setError("");
        setActiveOp("processing");
        setProcessingFormMode("edit");
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  // ---- Actions ----
  const beginHarvest = async () => {
    if (!itemKey) return;
    setActiveOp("none");
    setStep("verifyHarvest");
    await stopScanner();
    startHarvestLabelScanner();
  };

  const openHarvestFormEdit = () => {
    if (!harvestFound) return;
    setActiveOp("harvestEdit");
    setHarvestFormMode("edit");
  };

  const openProcessing = async () => {
    if (!harvestFound) return;
    setActiveOp("none");
    setStep("verifyProcessing");
    await stopScanner();
    startProcessingLabelScanner();
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
          itemKey,
          harvestingDateInput: harvestForm.harvestingDateInput,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });
      } else {
        const r = await appendHarvestLog({
          itemKey,
          harvestingDateInput: harvestForm.harvestingDateInput,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });

        // after create, we now have a harvest record
        if (r?.rowIndex) setHarvestRow(r.rowIndex);
        setHarvestFound(true);
      }

      setStatus(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      setHarvestFormMode("view");
      setActiveOp("none");

      // Refresh states from sheet so buttons reflect correct availability
      await loadItemAndHarvest(itemKey);
    } catch (e) {
      setStatus("");
      setError(e?.message || t("err_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveProcessing = async () => {
    setError("");
    setStatus(t("status_saving"));
    if (!itemKey) return;

    if (harvestRow == null) {
      setStatus("");
      setError(
        tt(
          "No Harvest record exists yet. Please run Harvest first.",
          "No existe registro de Harvest. Primero haga Harvest.",
          "Chưa có bản ghi Harvest. Vui lòng Harvest trước."
        )
      );
      return;
    }

    setIsSaving(true);
    try {
      await updateHarvestLogByRow({
        rowIndex: harvestRow,
        itemKey,
        processingDateInput: processingForm.processingDateInput,
        processingDate: processingForm.processingDate,
        numberXL: processingForm.numberXL,
        numberL: processingForm.numberL,
        numberM: processingForm.numberM,
        numberS: processingForm.numberS,
        numberOR: processingForm.numberOR,
      });

      setStatus(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      setProcessingFormMode("view");
      setActiveOp("none");

      await loadItemAndHarvest(itemKey);
    } catch (e) {
      setStatus("");
      setError(e?.message || t("err_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!proxyUrl) return <div>{t("please_go_setup_first")}</div>;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{t("tab_harvest")}</h3>

        {/* ALWAYS visible: Export ALL photos across ALL vines */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <ExportHarvestZipButton />
          <button onClick={() => setSetupOpen(true)}>{t("setup_title")}</button>
        </div>
      </div>

      {status && <div className="alert" style={{ marginTop: 10 }}>{status}</div>}
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}

      {/* Setup modal */}
      {setupOpen && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>
            {tt("Harvest Log Sheet Setup", "Configuración de Harvest Log", "Thiết lập Harvest Log")}
          </h4>

          {setupMsg && <div className="alert">{setupMsg}</div>}
          {setupErr && <div className="alert alert-error">{setupErr}</div>}

          <div style={{ display: "grid", gap: 8 }}>
            <label>
              {tt("Harvest Google Sheet link", "Enlace Google Sheet de Harvest", "Link Google Sheet Harvest")}
              <input
                value={harvestUrl}
                onChange={(e) => setHarvestUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                style={{ width: "100%" }}
              />
            </label>

            <label>
              {tt("Harvest tab name", "Nombre de pestaña Harvest", "Tên tab Harvest")}
              <input
                value={harvestSheetName}
                onChange={(e) => setHarvestSheetName(e.target.value)}
                placeholder="Harvesting Log"
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="primary" onClick={saveHarvestSetup} disabled={setupSaving}>
                {setupSaving ? t("saving") : t("save")}
              </button>
              <button onClick={() => setSetupOpen(false)}>{t("close")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Idle / Scan */}
      {step === "idle" && (
        <div style={{ marginTop: 12 }}>
          <p>
            {t("scan_hint_keycol")} <strong>{settings?.keyColumn}</strong>{" "}
            ({t("items_tab_label")} <strong>{settings?.itemsSheetName}</strong>)
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              className="primary"
              onClick={async () => {
                setStep("scanning");
                await stopScanner();
                startItemScanner();
              }}
            >
              {t("start")}
            </button>
          </div>

          <div id="harvest-item-reader" />
        </div>
      )}

      {/* Scanning item */}
      {step === "scanning" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              onClick={async () => {
                await stopScanner();
                setStep("idle");
              }}
            >
              {t("stop")}
            </button>
          </div>
          <div id="harvest-item-reader" />
        </div>
      )}

      {/* Verify Harvest Label */}
      {step === "verifyHarvest" && (
        <div style={{ marginTop: 12 }}>
          <div className="alert">
            {tt(
              "Scan the HARVEST LABEL QR to confirm (must match the item QR).",
              "Escanee la ETIQUETA DE COSECHA (debe coincidir).",
              "Quét QR NHÃN HARVEST để xác nhận (phải trùng)."
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              onClick={async () => {
                await stopScanner();
                setStep("viewItem");
              }}
            >
              {t("back")}
            </button>
          </div>

          <div id="harvest-label-reader" />
        </div>
      )}

      {/* Verify Processing Label */}
      {step === "verifyProcessing" && (
        <div style={{ marginTop: 12 }}>
          <div className="alert">
            {tt(
              "Scan the PROCESSING LABEL QR to confirm (must match the item QR).",
              "Escanee la ETIQUETA DE PROCESAMIENTO (debe coincidir).",
              "Quét QR NHÃN PROCESSING để xác nhận (phải trùng)."
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              onClick={async () => {
                await stopScanner();
                setStep("viewItem");
              }}
            >
              {t("back")}
            </button>
          </div>

          <div id="processing-label-reader" />
        </div>
      )}

      {/* View Item */}
      {step === "viewItem" && item && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{tt("Scanned Key", "Clave escaneada", "Mã đã quét")}</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{itemKey}</div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => returnToIdleReady()}>{t("scan_another")}</button>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <PrettyDetails item={item} preferredOrder={headers} />
            </div>
          </div>

          {/* Operation chooser - EXACTLY as your expected flow */}
          <div className="card">
            <h4 style={{ marginTop: 0 }}>
              {tt("Operations", "Operaciones", "Thao tác")}
            </h4>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/* Harvest: only when NO record */}
              <button className="primary" onClick={beginHarvest} disabled={harvestFound || isSaving}>
                {tt("Harvest", "Cosecha", "Harvest")}
              </button>

              {/* Harvest Form: only when record exists */}
              <button onClick={openHarvestFormEdit} disabled={!harvestFound || isSaving}>
                {tt("Harvest Form", "Formulario Harvest", "Harvest Form")}
              </button>

              {/* Processing: only when record exists */}
              <button onClick={openProcessing} disabled={!harvestFound || isSaving}>
                {tt("Processing", "Procesamiento", "Processing")}
              </button>
            </div>

            {!harvestFound && (
              <div className="alert" style={{ marginTop: 10 }}>
                {tt(
                  "No Harvest record found for this item. Tap Harvest to create one (you will be asked to scan the label QR).",
                  "No se encontró registro de Harvest. Presione Harvest para crear uno (se pedirá escanear etiqueta).",
                  "Chưa có bản ghi Harvest. Nhấn Harvest để tạo (sẽ yêu cầu quét nhãn)."
                )}
              </div>
            )}
          </div>

          {/* HARVEST (create/edit) */}
          {(activeOp === "harvestCreate" || activeOp === "harvestEdit") && (
            <div className="card">
              <h4 style={{ marginTop: 0 }}>
                {activeOp === "harvestCreate"
                  ? tt("Harvest (Create)", "Harvest (Crear)", "Harvest (Tạo)")
                  : tt("Harvest Form (Edit)", "Harvest Form (Editar)", "Harvest Form (Sửa)")}
              </h4>

              <div style={{ display: "grid", gap: 8 }}>
                <label>
                  {tt("Harvest Date Input", "Fecha de entrada", "Ngày nhập")}
                  <input
                    type="date"
                    value={harvestForm.harvestingDateInput}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDateInput: e.target.value }))}
                    disabled={harvestFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Harvest Date", "Fecha de cosecha", "Ngày Harvest")}
                  <input
                    type="date"
                    value={harvestForm.harvestingDate}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDate: e.target.value }))}
                    disabled={harvestFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Number of Shoots", "Número de brotes", "Số chồi")}
                  <input
                    value={harvestForm.numberOfShoot}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, numberOfShoot: e.target.value }))}
                    disabled={harvestFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Shoot 1 length", "Longitud brote 1", "Chiều dài chồi 1")}
                  <input
                    value={harvestForm.shoot1Length}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, shoot1Length: e.target.value }))}
                    disabled={harvestFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Shoot 2 length", "Longitud brote 2", "Chiều dài chồi 2")}
                  <input
                    value={harvestForm.shoot2Length}
                    onChange={(e) => setHarvestForm((p) => ({ ...p, shoot2Length: e.target.value }))}
                    disabled={harvestFormMode === "view" || isSaving}
                  />
                </label>
              </div>

              <div style={{ marginTop: 12 }}>
                <h4 style={{ margin: "10px 0 8px" }}>{tt("Harvest Photos", "Fotos", "Ảnh")}</h4>
                <HarvestCapture itemId={itemKey} />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveHarvest} disabled={isSaving}>
                  {isSaving ? t("saving") : t("save")}
                </button>

                <button
                  onClick={() => {
                    setActiveOp("none");
                    setHarvestFormMode(harvestFound ? "view" : "create");
                  }}
                  disabled={isSaving}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}

          {/* PROCESSING */}
          {activeOp === "processing" && (
            <div className="card">
              <h4 style={{ marginTop: 0 }}>{tt("Processing", "Procesamiento", "Processing")}</h4>

              <div style={{ display: "grid", gap: 8 }}>
                <label>
                  {tt("Processing Date Input", "Fecha de entrada", "Ngày nhập")}
                  <input
                    type="date"
                    value={processingForm.processingDateInput}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, processingDateInput: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Processing Date", "Fecha de procesamiento", "Ngày Processing")}
                  <input
                    type="date"
                    value={processingForm.processingDate}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, processingDate: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("X-Large", "Extra grande", "X-Large")}
                  <input
                    value={processingForm.numberXL}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberXL: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Large", "Grande", "Large")}
                  <input
                    value={processingForm.numberL}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberL: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Medium", "Mediano", "Medium")}
                  <input
                    value={processingForm.numberM}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberM: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("Small", "Pequeño", "Small")}
                  <input
                    value={processingForm.numberS}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberS: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>

                <label>
                  {tt("OR", "OR", "OR")}
                  <input
                    value={processingForm.numberOR}
                    onChange={(e) => setProcessingForm((p) => ({ ...p, numberOR: e.target.value }))}
                    disabled={processingFormMode === "view" || isSaving}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveProcessing} disabled={isSaving}>
                  {isSaving ? t("saving") : t("save")}
                </button>

                <button
                  onClick={() => {
                    setActiveOp("none");
                    setProcessingFormMode("view");
                  }}
                  disabled={isSaving}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* If setup missing */}
      {!harvestSpreadsheetId && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {tt(
            "Harvest Sheet is not set. Click Setup and paste your Harvest Google Sheet link.",
            "Harvest no está configurado. Haga clic en Setup y pegue el enlace.",
            "Chưa thiết lập Harvest Sheet. Nhấn Setup và dán link."
          )}
        </div>
      )}
    </div>
  );
}
