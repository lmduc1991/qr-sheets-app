import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, onSettingsChange, saveSettings } from "../store/settingsStore";
import { getSheetTabs } from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function normHeader(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getFieldCI(obj, headerName) {
  if (!obj) return "";
  const target = normHeader(headerName);
  for (const k of Object.keys(obj)) {
    if (normHeader(k) === target) return obj[k];
  }
  return "";
}

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

// Minimal local API caller (keeps this page independent; avoids breaking other pages)
async function callProxy(action, payload, { timeoutMs = 15000 } = {}) {
  const s = loadSettings();
  if (!s?.proxyUrl) throw new Error("Missing Proxy URL. Go to Setup and save settings first.");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(s.proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Request failed (${resp.status})`);
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Request timed out. Check internet or Apps Script.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export default function PackingUnpackingManagementPage() {
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  // Keep settings reactive
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const proxyUrl = settings?.proxyUrl || "";

  // Setup state
  const [packingUrl, setPackingUrl] = useState(settings?.packingUrl || "");
  const [orSheetName, setOrSheetName] = useState(settings?.packingOrSheetName || "");
  const [graftingSheetName, setGraftingSheetName] = useState(settings?.packingGraftingSheetName || "");

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const packingSpreadsheetId = useMemo(() => extractSpreadsheetId(packingUrl), [packingUrl]);

  // Scanner
  const scannerRef = useRef(null);
  const scanLockRef = useRef({ last: "", ts: 0 }); // dedupe
  const [isScanning, setIsScanning] = useState(false);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const startScanner = (elementId, onScan) => {
    if (scannerRef.current) return;

    const el = document.getElementById(elementId);
    if (el) el.innerHTML = "";

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      elementId,
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const v = String(decodedText || "").trim();
        if (!v) return;

        // Dedup repeats (2 seconds)
        const now = Date.now();
        const last = scanLockRef.current;
        if (last.last === v && now - last.ts < 2000) return;
        scanLockRef.current = { last: v, ts: now };

        await onScan(v);
      },
      () => {}
    );

    scannerRef.current = scanner;
    setIsScanning(true);
  };

  // -------------------------
  // Load tabs / Save setup
  // -------------------------
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

  const ensureOrTab = () => {
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
    if (!orSheetName.trim()) {
      alert(
        tt(
          "OR tab is not set. Choose the OR tab and Save Packing Setup.",
          "No está configurada la pestaña OR. Elígela y guarda.",
          "Chưa thiết lập tab OR. Chọn tab rồi lưu."
        )
      );
      return false;
    }
    return true;
  };

  // =====================================================================
  // OR-Packing Implementation (frontend)
  // Rule: Scan1 exists in OR tab WHITE CODE; Scan2 must equal Scan1.
  // =====================================================================
  const [mode, setMode] = useState(""); // "or-pack" | etc
  const [step, setStep] = useState("idle"); // idle | or_scan1 | or_scan2 | or_form
  const [label1, setLabel1] = useState("");
  const [label2, setLabel2] = useState("");

  const [record, setRecord] = useState(null);
  const [rowIndex, setRowIndex] = useState(null);

  const [packingDate, setPackingDate] = useState("");
  const [packingQty, setPackingQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const resetOrPacking = async () => {
    await stopScanner();
    setMode("");
    setStep("idle");
    setLabel1("");
    setLabel2("");
    setRecord(null);
    setRowIndex(null);
    setPackingDate("");
    setPackingQty("");
    setNote("");
    setMsg("");
    setError("");
  };

  const beginOrPacking = async () => {
    if (!ensureOrTab()) return;

    await resetOrPacking();
    setMode("or-pack");
    setStep("or_scan1");
    setMsg(
      tt(
        "OR-Packing: Scan White Code #1 (must exist in OR tab).",
        "OR-Empaque: Escanea White Code #1 (debe existir en la pestaña OR).",
        "OR-Đóng gói: Quét White Code lần 1 (phải tồn tại trong tab OR)."
      )
    );

    await stopScanner();

    setTimeout(() => {
      startScanner("or-pack-scan1", async (v1) => {
        try {
          await stopScanner();
          setError("");
          setMsg(tt("Checking White Code in sheet…", "Verificando White Code…", "Đang kiểm tra White Code…"));

          // Scan1 must exist in OR tab WHITE CODE
          const r = await callProxy("getPackingRecordByLabel", {
            spreadsheetId: packingSpreadsheetId,
            sheetName: orSheetName,
            needs: "or",
            labelValue: v1,
          });

          if (!r?.found) {
            alert(
              tt(
                `Not found. White Code "${v1}" does not exist in OR tab.`,
                `No encontrado. White Code "${v1}" no existe en la pestaña OR.`,
                `Không tìm thấy. White Code "${v1}" không tồn tại trong tab OR.`
              )
            );
            // Resume scan1
            setStep("or_scan1");
            setMsg("");
            setTimeout(() => beginOrPacking(), 200);
            return;
          }

          setLabel1(String(v1).trim());
          setRecord(r.record || null);
          setRowIndex(r.rowIndex || null);

          // Move to Scan2 (confirm same code)
          setMsg(
            tt(
              "Scan the SAME White Code again to confirm (#2).",
              "Escanea el MISMO White Code para confirmar (#2).",
              "Quét LẠI đúng White Code để xác nhận (lần 2)."
            )
          );
          setStep("or_scan2");
          setTimeout(() => beginOrPackingScanSecond(), 100);
        } catch (e) {
          setMsg("");
          setError(e?.message || "Failed to validate White Code.");
          setStep("or_scan1");
        }
      });
    }, 120);
  };

  // This function belongs to this page and enforces: scan2 === scan1
  const beginOrPackingScanSecond = async () => {
    setError("");
    setMsg(
      tt(
        "Scan the SAME White Code again to confirm…",
        "Escanea el MISMO White Code para confirmar…",
        "Quét LẠI đúng White Code để xác nhận…"
      )
    );
    setLabel2("");
    setStep("or_scan2");

    await stopScanner();

    setTimeout(() => {
      startScanner("or-pack-scan2", async (v2) => {
        await stopScanner();
        setError("");

        const v2Trim = String(v2 || "").trim();
        const v1Trim = String(label1 || "").trim();

        // Rule: second scan must equal the first scan (exact match)
        if (v2Trim !== v1Trim) {
          alert(
            tt(
              "Not matched. The second scan must be the SAME White Code as the first scan. Please scan again.",
              "No coincide. El segundo escaneo debe ser el MISMO White Code. Reintenta.",
              "Không khớp. Lần quét thứ hai phải GIỐNG hệt White Code lần đầu. Quét lại."
            )
          );

          // Resume scan2
          setLabel2("");
          setMsg("");
          setStep("or_scan2");

          // Restart scan2 scanner
          setTimeout(() => {
            beginOrPackingScanSecond();
          }, 200);
          return;
        }

        // Matched
        setLabel2(v2Trim);
        setMsg(tt("Matched. Fill Packing Form.", "Coincide. Completa el formulario.", "Khớp. Điền form."));

        // Prefill from record (case-insensitive)
        const rec = record || {};
        const pd = getFieldCI(rec, "PACKING DATE");
        const pq = getFieldCI(rec, "PACKING QUANTITY");
        if (hasValue(pd)) setPackingDate(String(pd));
        if (hasValue(pq)) setPackingQty(String(pq));

        setStep("or_form");
      });
    }, 120);
  };

  const saveOrPacking = async () => {
    setError("");
    setMsg("");

    if (!rowIndex || rowIndex < 2) return setError("Missing rowIndex from sheet record.");
    if (!hasValue(packingDate)) return setError(tt("Packing Date is required.", "Fecha requerida.", "Cần Packing Date."));
    if (!hasValue(packingQty)) return setError(tt("Packing Quantity is required.", "Cantidad requerida.", "Cần số lượng."));

    setSaving(true);
    try {
      const noteAppend = hasValue(note)
        ? `OR-Packing ${new Date().toISOString().slice(0, 10)} - ${note}`
        : "";

      await callProxy("updatePackingByRow", {
        spreadsheetId: packingSpreadsheetId,
        sheetName: orSheetName,
        needs: "or",
        rowIndex,
        packingDate: String(packingDate).trim(),
        packingQuantity: String(packingQty).trim(),
        noteAppend,
      });

      setMsg(
        tt(
          "Saved. Ready for next OR-Packing scan.",
          "Guardado. Listo para el siguiente OR-Empaque.",
          "Đã lưu. Sẵn sàng quét OR-Đóng gói tiếp theo."
        )
      );

      // Reset to scan1 for next item
      setLabel1("");
      setLabel2("");
      setRecord(null);
      setRowIndex(null);
      setPackingDate("");
      setPackingQty("");
      setNote("");
      setStep("or_scan1");

      // Restart scan1
      setTimeout(() => beginOrPacking(), 250);
    } catch (e) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // -------------------------
  // Page rendering
  // -------------------------
  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  const MODES = [
    { id: "or-pack", label: tt("OR-Packing", "OR-Empaque", "OR-Đóng gói") },
    { id: "or-unpack", label: tt("OR-Unpacking", "OR-Desempaque", "OR-Mở gói") },
    { id: "graft-pack", label: tt("Grafting-Packing", "Injerto-Empaque", "Ghép-Đóng gói") },
    { id: "graft-unpack", label: tt("Grafting-Unpacking", "Injerto-Desempaque", "Ghép-Mở gói") },
  ];

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>{t("tab_packing")}</h2>

      {(msg || error) && (
        <div className="card" style={{ marginBottom: 10 }}>
          {error && <div className="alert alert-error">{error}</div>}
          {msg && <div className="alert alert-ok">{msg}</div>}
        </div>
      )}

      {/* Setup */}
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
              <input
                value={graftingSheetName}
                onChange={(e) => setGraftingSheetName(e.target.value)}
                placeholder="GRAFTING"
              />
            )}
          </label>
        </div>

        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>{t("optional_note")}</div>
      </div>

      {/* Operation buttons */}
      <div className="card">
        <h3>{t("choose_operation")}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setError("");
                setMsg("");
                if (m.id === "or-pack") {
                  beginOrPacking();
                } else {
                  alert(
                    tt(
                      "Not implemented yet. We are implementing OR-Packing first.",
                      "Aún no implementado. Primero implementamos OR-Packing.",
                      "Chưa triển khai. Đang làm OR-Packing trước."
                    )
                  );
                }
              }}
            >
              {m.label}
            </button>
          ))}
          {mode && (
            <button onClick={resetOrPacking} style={{ marginLeft: "auto" }}>
              {tt("Reset", "Reiniciar", "Reset")}
            </button>
          )}
        </div>
      </div>

      {/* OR-Packing UI */}
      {mode === "or-pack" && (
        <div className="card">
          <h3>{tt("OR-Packing", "OR-Empaque", "OR-Đóng gói")}</h3>

          {step === "or_scan1" && (
            <>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>
                {tt("Step 1: Scan White Code #1", "Paso 1: Escanear White Code #1", "Bước 1: Quét White Code lần 1")}
              </div>
              <div id="or-pack-scan1" />
              {isScanning && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {tt("Scanning…", "Escaneando…", "Đang quét…")}
                </div>
              )}
            </>
          )}

          {step === "or_scan2" && (
            <>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>
                {tt(
                  "Step 2: Scan SAME White Code again",
                  "Paso 2: Escanear el MISMO White Code",
                  "Bước 2: Quét LẠI đúng White Code"
                )}
              </div>
              <div style={{ marginBottom: 8 }}>
                <div>
                  <b>{tt("Scan #1:", "Escaneo #1:", "Quét lần 1:")}</b> {label1 || "-"}
                </div>
              </div>
              <div id="or-pack-scan2" />
              {isScanning && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {tt("Scanning…", "Escaneando…", "Đang quét…")}
                </div>
              )}
            </>
          )}

          {step === "or_form" && (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <b>{tt("White Code:", "White Code:", "White Code:")}</b> {label1}
                </div>

                <label className="field">
                  {tt("Packing Date", "Fecha de empaque", "Ngày đóng gói")}
                  <input value={packingDate} onChange={(e) => setPackingDate(e.target.value)} placeholder="YYYY-MM-DD" />
                </label>

                <label className="field">
                  {tt("Packing Quantity", "Cantidad", "Số lượng")}
                  <input value={packingQty} onChange={(e) => setPackingQty(e.target.value)} placeholder="e.g. 100" />
                </label>

                <label className="field">
                  {tt("Note (optional, append)", "Nota (opcional, anexar)", "Ghi chú (tuỳ chọn, nối thêm)")}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="" />
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveOrPacking} disabled={saving}>
                    {saving ? t("saving") || "Saving..." : t("save") || "Save"}
                  </button>
                  <button
                    onClick={async () => {
                      setStep("or_scan1");
                      setMsg("");
                      setError("");
                      setLabel1("");
                      setLabel2("");
                      setRecord(null);
                      setRowIndex(null);
                      await stopScanner();
                      setTimeout(() => beginOrPacking(), 200);
                    }}
                    disabled={saving}
                  >
                    {tt("Cancel / Back", "Cancelar / Atrás", "Hủy / Quay lại")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
