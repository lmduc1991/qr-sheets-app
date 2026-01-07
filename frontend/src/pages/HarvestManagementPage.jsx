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
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const { t } = useT();

  // Reactive settings (no reload needed)
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const keyColumn = settings?.keyColumn || "";

  // Harvest sheet setup inside Harvest tab
  const [harvestUrl, setHarvestUrl] = useState(settings?.harvestUrl || "");
  const [harvestSheetName, setHarvestSheetName] = useState(settings?.harvestSheetName || "Harvesting Log");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [setupErr, setSetupErr] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);

  useEffect(() => {
    setHarvestUrl(settings?.harvestUrl || "");
    setHarvestSheetName(settings?.harvestSheetName || "Harvesting Log");
  }, [settings?.harvestUrl, settings?.harvestSheetName]);

  const harvestSpreadsheetId = extractSpreadsheetId(harvestUrl);
  const harvestReady = !!settings?.harvestSpreadsheetId && !!settings?.harvestSheetName;

  const saveHarvestSetup = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!settings?.proxyUrl) return setSetupErr(t("err_missing_proxy_setup"));
    if (!harvestSpreadsheetId) return setSetupErr(t("err_harvest_link_invalid"));
    if (!String(harvestSheetName || "").trim()) return setSetupErr(t("err_harvest_tab_required"));

    setSetupSaving(true);
    try {
      saveSettings({
        harvestUrl,
        harvestSpreadsheetId,
        harvestSheetName: harvestSheetName.trim(),
      });
      setSetupMsg(t("harvest_settings_saved"));
      setSetupOpen(false);
    } catch (e) {
      setSetupErr(e.message || t("err_failed_save_harvest_settings"));
    } finally {
      setSetupSaving(false);
    }
  };

  // Workflow steps:
  // idle | scanItem | viewItem | verifyHarvest | harvestForm | verifyProcessing | processingForm
  const [step, setStep] = useState("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [itemKey, setItemKey] = useState("");
  const [item, setItem] = useState(null);
  const [headers, setHeaders] = useState([]);

  const [harvestExists, setHarvestExists] = useState(false);
  const [harvestRow, setHarvestRow] = useState(null);

  const [harvestFormMode, setHarvestFormMode] = useState("create"); // create | view | edit
  const [harvestForm, setHarvestForm] = useState({
    harvestingDate: today(),
    numberOfShoot: "",
    shoot1Length: "",
    shoot2Length: "",
  });

  const [processingFormMode, setProcessingFormMode] = useState("view"); // view | edit
  const [processingForm, setProcessingForm] = useState({
    processingDate: today(),
    xLarge: "",
    large: "",
    medium: "",
    small: "",
    orCount: "",
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
  };

  const startScanner = (domId, onScanOnce) => {
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
        const key = String(decodedText || "").trim();
        if (!key) return;
        await stopScanner();
        onScanOnce(key);
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const resetStateForNewScan = () => {
    setItemKey("");
    setItem(null);
    setHeaders([]);

    setHarvestExists(false);
    setHarvestRow(null);

    setHarvestFormMode("create");
    setHarvestForm({
      harvestingDate: today(),
      numberOfShoot: "",
      shoot1Length: "",
      shoot2Length: "",
    });

    setProcessingFormMode("view");
    setProcessingForm({
      processingDate: today(),
      xLarge: "",
      large: "",
      medium: "",
      small: "",
      orCount: "",
    });
  };

  const beginScanItem = async () => {
    setStatus("");
    setError("");
    resetStateForNewScan();
    setStep("scanItem");

    await stopScanner();
    setTimeout(() => {
      startScanner("harvest-item-reader", async (key) => {
        setError("");
        setStatus(t("status_loading_item_log"));

        try {
          const r = await getItemAndHarvestByKey(key);

          const ir = r?.items;
          setHeaders(ir?.headers || []);
          if (!ir?.found) {
            const tab = settings?.itemsSheetName ? `"${settings.itemsSheetName}"` : "Items tab";
            throw new Error(`${t("err_item_not_found_in")} ${tab}.`);
          }

          setItemKey(key);
          setItem(ir?.item || null);

          const hr = r?.harvest;
          if (hr?.found) {
            setHarvestExists(true);
            setHarvestRow(hr.rowIndex);

            setHarvestForm({
              harvestingDate: hr.data?.harvestingDate || today(),
              numberOfShoot: hr.data?.numberOfShoot || "",
              shoot1Length: hr.data?.shoot1Length || "",
              shoot2Length: hr.data?.shoot2Length || "",
            });
            setHarvestFormMode("view");

            setProcessingForm({
              processingDate: hr.data?.processingDate || today(),
              xLarge: hr.data?.xLarge || "",
              large: hr.data?.large || "",
              medium: hr.data?.medium || "",
              small: hr.data?.small || "",
              orCount: hr.data?.orCount || "",
            });
            setProcessingFormMode("view");

            setStatus(t("status_item_loaded_log_exists"));
          } else {
            setHarvestExists(false);
            setHarvestFormMode("create");
            setStatus(t("status_item_loaded_no_log"));
          }

          setStep("viewItem");
        } catch (e) {
          setStatus("");
          setError(e.message || t("err_failed_load_item_harvest"));
          setStep("scanItem");
        }
      });
    }, 150);
  };

  const verifyLabel = async (domId, nextStep) => {
    setError("");
    setStatus(t("status_scan_label_must_match"));
    await stopScanner();

    setTimeout(() => {
      startScanner(domId, async (scanned) => {
        if (scanned === itemKey) {
          setError("");
          setStatus(t("status_matched"));
          setStep(nextStep);
          return;
        }
        alert("QR not match, please scan another");
        verifyLabel(domId, nextStep);
      });
    }, 150);
  };

  const beginVerifyHarvest = async () => {
    setStep("verifyHarvest");
    setHarvestFormMode("create");
    await verifyLabel("harvest-label-reader", "harvestForm");
  };

  const beginVerifyProcessing = async () => {
    setStep("verifyProcessing");
    setProcessingFormMode("edit");
    await verifyLabel("processing-label-reader", "processingForm");
  };

  // after save, return to idle + clear item
  const returnToIdleReady = async (successMsg) => {
    await stopScanner();
    resetStateForNewScan();
    setStep("idle");
    setError("");
    setStatus(successMsg || t("msg_saved_ready_next"));
  };

  const saveHarvest = async () => {
    setError("");
    setStatus(t("status_saving_harvest_log"));
    setIsSaving(true);

    try {
      const photoCount = getPhotoCount(itemKey);

      if (harvestExists && harvestRow != null) {
        await updateHarvestLogByRow({
          rowIndex: harvestRow,
          itemKey,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });
      } else {
        await appendHarvestLog({
          itemKey,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount,
        });
      }

      await returnToIdleReady(t("msg_harvest_saved_ready"));
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_save_harvest"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveProcessing = async () => {
    setError("");
    setStatus(t("status_saving_processing"));
    setIsSaving(true);

    try {
      if (!harvestExists || harvestRow == null) {
        throw new Error(t("err_save_harvest_first"));
      }

      await updateHarvestLogByRow({
        rowIndex: harvestRow,
        itemKey,

        processingDate: processingForm.processingDate,
        xLarge: processingForm.xLarge,
        large: processingForm.large,
        medium: processingForm.medium,
        small: processingForm.small,
        orCount: processingForm.orCount,
      });

      await returnToIdleReady(t("msg_processing_saved_ready"));
    } catch (e) {
      setStatus("");
      setError(e.message || t("err_failed_save_processing"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings?.proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  return (
    <div className="page">
      <h2>{t("harvest_title")}</h2>

      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ExportHarvestZipButton />
        <button
          onClick={() => {
            setSetupOpen((v) => !v);
            setSetupErr("");
            setSetupMsg("");
          }}
        >
          {setupOpen ? t("close_harvest_settings") : t("harvest_settings")}
        </button>
      </div>

      {(setupOpen || !harvestReady) && (
        <div className="card" style={{ marginTop: 10 }}>
          <h3>{t("harvest_log_setup")}</h3>
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
            {setupSaving ? t("saving") : t("save_harvest_setup")}
          </button>
        </div>
      )}

      {(status || error) && (
        <div className="card" style={{ marginTop: 10 }}>
          {status && <div className="alert">{status}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      )}

      {step === "idle" && (
        <div className="card">
          <p>{t("help_ready_click_start")}</p>
          <button className="primary" onClick={beginScanItem} disabled={!harvestReady}>
            {t("start_scanning")}
          </button>
          {!harvestReady && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              {t("help_complete_harvest_setup_first")}
            </div>
          )}
        </div>
      )}

      {step === "scanItem" && (
        <div className="card">
          <p>
            {t("scan_item_qr_key_column")} <strong>{keyColumn}</strong>)
          </p>
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
            {t("btn_stop")}
          </button>
        </div>
      )}

      {step === "viewItem" && (
        <div className="card">
          <div>
            <strong>{t("scanned_key")}:</strong> {itemKey}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              className="primary"
              onClick={beginVerifyHarvest}
              disabled={harvestExists}
              style={harvestExists ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              {t("btn_harvest")}
            </button>

            <button
              onClick={() => {
                setStep("harvestForm");
                setHarvestFormMode("view");
              }}
              disabled={!harvestExists}
              style={!harvestExists ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              {t("btn_harvest_form")}
            </button>

            <button
              onClick={beginVerifyProcessing}
              disabled={!harvestExists}
              style={!harvestExists ? { opacity: 0.4, cursor: "not-allowed", filter: "blur(0.4px)" } : undefined}
              title={!harvestExists ? t("err_save_harvest_first") : t("status_scan_label_must_match")}
            >
              {t("btn_wood_processing")}
            </button>

            <button
              onClick={async () => {
                await returnToIdleReady(t("msg_saved_ready_next"));
              }}
            >
              {t("done")}
            </button>
          </div>

          <h3 style={{ marginTop: 14 }}>{t("item_details")}</h3>
          <PrettyDetails item={item} preferredOrder={headers} />
        </div>
      )}

      {step === "verifyHarvest" && (
        <div className="card">
          <p>
            {t("verify_harvest_label")} <strong>{itemKey}</strong>).
          </p>
          <div id="harvest-label-reader" />
          <button style={{ marginTop: 10 }} onClick={() => setStep("viewItem")}>
            {t("cancel")}
          </button>
        </div>
      )}

      {step === "harvestForm" && (
        <div className="card">
          <h3>{t("harvest_form_title")}</h3>
          <div style={{ marginBottom: 10 }}>
            <strong>{t("label_item")}:</strong> {itemKey}
          </div>

          <div className="grid">
            <label className="field">
              {t("harvest_date")}
              <input
                type="date"
                value={harvestForm.harvestingDate}
                onChange={(e) => setHarvestForm((p) => ({ ...p, harvestingDate: e.target.value }))}
                disabled={harvestFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("number_of_shoots")}
              <input
                value={harvestForm.numberOfShoot}
                onChange={(e) => setHarvestForm((p) => ({ ...p, numberOfShoot: e.target.value }))}
                disabled={harvestFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("shoot1_length")}
              <input
                value={harvestForm.shoot1Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot1Length: e.target.value }))}
                disabled={harvestFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("shoot2_length")}
              <input
                value={harvestForm.shoot2Length}
                onChange={(e) => setHarvestForm((p) => ({ ...p, shoot2Length: e.target.value }))}
                disabled={harvestFormMode === "view"}
              />
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <HarvestCapture itemId={itemKey} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {harvestFormMode === "view" ? (
              <button className="primary" onClick={() => setHarvestFormMode("edit")}>
                {t("edit")}
              </button>
            ) : (
              <button className="primary" onClick={saveHarvest} disabled={isSaving}>
                {isSaving ? t("saving") : t("save")}
              </button>
            )}

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
      )}

      {step === "verifyProcessing" && (
        <div className="card">
          <p>
            {t("verify_processing_label")} <strong>{itemKey}</strong>).
          </p>
          <div id="processing-label-reader" />
          <button style={{ marginTop: 10 }} onClick={() => setStep("viewItem")}>
            {t("cancel")}
          </button>
        </div>
      )}

      {step === "processingForm" && (
        <div className="card">
          <h3>{t("wood_processing_form_title")}</h3>
          <div style={{ marginBottom: 10 }}>
            <strong>{t("label_item")}:</strong> {itemKey}
          </div>

          <div className="grid">
            <label className="field">
              {t("processing_date")}
              <input
                type="date"
                value={processingForm.processingDate}
                onChange={(e) => setProcessingForm((p) => ({ ...p, processingDate: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("xlarge_label")}
              <input
                value={processingForm.xLarge}
                onChange={(e) => setProcessingForm((p) => ({ ...p, xLarge: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("large_label")}
              <input
                value={processingForm.large}
                onChange={(e) => setProcessingForm((p) => ({ ...p, large: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("medium_label")}
              <input
                value={processingForm.medium}
                onChange={(e) => setProcessingForm((p) => ({ ...p, medium: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("small_label")}
              <input
                value={processingForm.small}
                onChange={(e) => setProcessingForm((p) => ({ ...p, small: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>

            <label className="field">
              {t("or_label")}
              <input
                value={processingForm.orCount}
                onChange={(e) => setProcessingForm((p) => ({ ...p, orCount: e.target.value }))}
                disabled={processingFormMode === "view"}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {processingFormMode === "view" ? (
              <button className="primary" onClick={() => setProcessingFormMode("edit")}>
                {t("edit")}
              </button>
            ) : (
              <button className="primary" onClick={saveProcessing} disabled={isSaving}>
                {isSaving ? t("saving") : t("btn_save_processing")}
              </button>
            )}

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
      )}
    </div>
  );
}
