import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import { getSheetTabs, getPackingRecordByLabel, updatePackingByRow } from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function hasValue(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Case-insensitive field lookup from a record object */
function normKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " "); // collapse whitespace
}
function getFieldCI(record, fieldName) {
  if (!record || typeof record !== "object") return "";
  const target = normKey(fieldName);
  for (const k of Object.keys(record)) {
    if (normKey(k) === target) return record[k];
  }
  return "";
}

function PrettyRecord({ record }) {
  if (!record) return null;
  const entries = Object.entries(record || {}).filter(([k, v]) => k && hasValue(v));
  if (entries.length === 0) return <div style={{ opacity: 0.8 }}>No record fields.</div>;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {entries.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 260px) 1fr",
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

export default function PackingUnpackingManagementPage() {
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  // Reactive settings (same pattern as BinStoragePage)
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => onSettingsChange(setSettings), []);

  const proxyUrl = settings?.proxyUrl || "";

  // ---- Setup states ----
  const [packingUrl, setPackingUrl] = useState(settings?.packingUrl || "");
  const [orSheetName, setOrSheetName] = useState(settings?.packingOrSheetName || "");
  const [graftingSheetName, setGraftingSheetName] = useState(settings?.packingGraftingSheetName || "");

  useEffect(() => {
    setPackingUrl(settings?.packingUrl || "");
    setOrSheetName(settings?.packingOrSheetName || "");
    setGraftingSheetName(settings?.packingGraftingSheetName || "");
  }, [settings?.packingUrl, settings?.packingOrSheetName, settings?.packingGraftingSheetName]);

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const packingSpreadsheetId = extractSpreadsheetId(packingUrl);
  const packingReady = !!settings?.packingSpreadsheetId && !!settings?.packingOrSheetName;

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
      setError(e?.message || tt("Failed to load tabs.", "No se pudieron cargar las pestañas.", "Không thể tải tab."));
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

  const MODES = useMemo(
    () => [
      { id: "or-pack", label: tt("OR-Packing", "OR-Empaque", "OR-Đóng gói"), needs: "or" },
      { id: "or-unpack", label: tt("OR-Unpacking", "OR-Desempaque", "OR-Mở gói"), needs: "or" },
      { id: "graft-pack", label: tt("Grafting-Packing", "Injerto-Empaque", "Ghép-Đóng gói"), needs: "grafting" },
      {
        id: "graft-unpack",
        label: tt("Grafting-Unpacking", "Injerto-Desempaque", "Ghép-Mở gói"),
        needs: "grafting",
      },
    ],
    [lang]
  );

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
    if (needs === "or" && !orSheetName.trim()) {
      alert(
        tt(
          "OR tab is not set. Choose the OR tab and Save Packing Setup.",
          "No está configurada la pestaña OR. Elígela y guarda.",
          "Chưa thiết lập tab OR. Chọn tab rồi lưu."
        )
      );
      return false;
    }
    if (needs === "grafting" && !graftingSheetName.trim()) {
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

  // ------------------------
  // OR-Packing implementation (frontend first)
  // ------------------------
  const [activeMode, setActiveMode] = useState(null); // 'or-pack' etc
  const [step, setStep] = useState("idle"); // idle | or_scan1 | or_record | or_scan2 | or_form

  const [label1, setLabel1] = useState("");
  const [label2, setLabel2] = useState("");
  const [rowIndex, setRowIndex] = useState(null);
  const [record, setRecord] = useState(null);

  const [formMode, setFormMode] = useState("create"); // create | edit
  const [packingDate, setPackingDate] = useState(today());
  const [packingQty, setPackingQty] = useState("");
  const [noteAppend, setNoteAppend] = useState("");

  const [isSaving, setIsSaving] = useState(false);

  // Scanner infra (dedupe + lock like BinStorage)
  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);
  const lastScanRef = useRef({ value: "", ts: 0 });
  const SCAN_LOCK_MS = 800;
  const DEDUPE_SAME_VALUE_MS = 2500;

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScanner = (domId, onScan) => {
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
        const v = String(decodedText || "").trim();
        if (!v) return;

        const now = Date.now();
        if (lastScanRef.current.value === v && now - lastScanRef.current.ts < DEDUPE_SAME_VALUE_MS) return;
        if (scanLockRef.current) return;

        scanLockRef.current = true;
        lastScanRef.current = { value: v, ts: now };

        try {
          await Promise.resolve(onScan(v));
        } finally {
          setTimeout(() => {
            scanLockRef.current = false;
          }, SCAN_LOCK_MS);
        }
      },
      () => {}
    );

    scannerRef.current = scanner;
  };

  const resetOrPacking = async () => {
    await stopScanner();
    setMsg("");
    setError("");
    setLabel1("");
    setLabel2("");
    setRowIndex(null);
    setRecord(null);
    setFormMode("create");
    setPackingDate(today());
    setPackingQty("");
    setNoteAppend("");
    setIsSaving(false);
    setStep("idle");
    setActiveMode(null);
  };

  const beginOrPacking = async () => {
    if (!ensureTabForMode("or")) return;

    setActiveMode("or-pack");
    setMsg("");
    setError("");
    setLabel1("");
    setLabel2("");
    setRowIndex(null);
    setRecord(null);
    setFormMode("create");
    setPackingDate(today());
    setPackingQty("");
    setNoteAppend("");

    setStep("or_scan1");
    await stopScanner();

    setTimeout(() => {
      startScanner("or-pack-scan1", async (v) => {
        await stopScanner();
        setMsg(tt("Looking up record…", "Buscando registro…", "Đang tìm bản ghi…"));
        setError("");

        try {
          const r = await getPackingRecordByLabel({ needs: "or", labelValue: v });
          if (!r?.found) {
            alert(
              tt(
                "No record found. Operation cancelled.",
                "No se encontró registro. Cancelado.",
                "Không có bản ghi. Đã huỷ."
              )
            );
            await resetOrPacking();
            return;
          }

          const rec = r.record || null;
          const ri = r.rowIndex;

          setLabel1(v);
          setRowIndex(ri);
          setRecord(rec);

          // Case-insensitive reads for template headers (e.g., PACKING DATE)
          const pd = getFieldCI(rec, "Packing Date"); // works for PACKING DATE too
          const pq = getFieldCI(rec, "Packing Quantity");

          const alreadyPacked = hasValue(pd) || hasValue(pq);

          setMsg(
            alreadyPacked
              ? tt("Record found (already packed).", "Registro encontrado (ya empacado).", "Tìm thấy (đã đóng gói).")
              : tt(
                  "Record found (ready to pack).",
                  "Registro encontrado (listo para empacar).",
                  "Tìm thấy (sẵn sàng đóng gói)."
                )
          );

          setStep("or_record");
        } catch (e) {
          setMsg("");
          setError(e?.message || "Lookup failed.");
          setStep("or_scan1");
        }
      });
    }, 120);
  };

  const beginOrPackingScanSecond = async () => {
    setError("");
    setMsg(tt("Scan the second label QR…", "Escanea el segundo QR…", "Quét QR thứ hai…"));
    setLabel2("");
    setStep("or_scan2");

    await stopScanner();

    setTimeout(() => {
      startScanner("or-pack-scan2", async (v2) => {
        try {
          await stopScanner();
          setMsg(tt("Validating match…", "Validando coincidencia…", "Đang kiểm tra khớp…"));
          setError("");

          const r2 = await getPackingRecordByLabel({ needs: "or", labelValue: v2 });
          if (!r2?.found || r2?.rowIndex == null) {
            alert(
              tt(
                "Second label not found. Please rescan.",
                "Segundo QR no encontrado. Reintenta.",
                "Không tìm thấy QR thứ hai. Quét lại."
              )
            );

            setLabel2("");
            setMsg("");
            setError("");
            setStep("or_scan2");
            setTimeout(() => beginOrPackingScanSecond(), 250);
            return;
          }

          if (String(r2.rowIndex) !== String(rowIndex)) {
            alert(
              tt(
                "QR labels do not match (not on the same row). Rescan or cancel.",
                "Los QR no coinciden (no están en la misma fila). Reintenta o cancela.",
                "QR không khớp (không cùng hàng). Quét lại hoặc huỷ."
              )
            );

            setLabel2("");
            setMsg("");
            setError("");
            setStep("or_scan2");
            setTimeout(() => beginOrPackingScanSecond(), 250);
            return;
          }

          setLabel2(v2);
          setMsg(tt("Matched. Fill Packing Form.", "Coincide. Completa el formulario.", "Khớp. Điền form."));
          setFormMode("create");

          // Prefill (case-insensitive)
          const rec = record || {};
          const pd = getFieldCI(rec, "Packing Date");
          const pq = getFieldCI(rec, "Packing Quantity");
          if (hasValue(pd)) setPackingDate(String(pd));
          if (hasValue(pq)) setPackingQty(String(pq));

          setStep("or_form");
        } catch (e) {
          setMsg("");
          setError(e?.message || "Validation failed.");
          setStep("or_scan2");
        }
      });
    }, 120);
  };

  const openEditPackingForm = () => {
    setError("");
    setMsg(tt("Edit Packing Form.", "Editar formulario de empaque.", "Sửa form đóng gói."));
    setFormMode("edit");

    const rec = record || {};
    const pd = getFieldCI(rec, "Packing Date");
    const pq = getFieldCI(rec, "Packing Quantity");
    if (hasValue(pd)) setPackingDate(String(pd));
    if (hasValue(pq)) setPackingQty(String(pq));

    setStep("or_form");
  };

  const saveOrPacking = async () => {
    if (isSaving) return;
    setError("");
    setMsg(tt("Saving…", "Guardando…", "Đang lưu…"));
    setIsSaving(true);

    try {
      if (rowIndex == null) throw new Error("Missing row index.");

      const r = await updatePackingByRow({
        needs: "or",
        rowIndex,
        label1,
        label2,
        packingDate: String(packingDate || "").trim(),
        packingQuantity: String(packingQty || "").trim(),
        noteAppend: String(noteAppend || "").trim(),
      });

      setMsg(
        tt(
          `Saved. Updated: ${r?.updated ?? 0}. Ready.`,
          `Guardado. Actualizado: ${r?.updated ?? 0}.`,
          `Đã lưu. Cập nhật: ${r?.updated ?? 0}.`
        )
      );
      await resetOrPacking();
    } catch (e) {
      setMsg("");
      setError(e?.message || "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const startMode = async (m) => {
    if (!ensureTabForMode(m.needs)) return;

    // Only OR-Packing is implemented now (frontend first).
    if (m.id === "or-pack") {
      await beginOrPacking();
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

  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h2>{t("tab_packing")}</h2>

      {(msg || error) && (
        <div className="card" style={{ marginBottom: 10 }}>
          {error && <div className="alert alert-error">{error}</div>}
          {msg && <div className="alert alert-ok">{msg}</div>}
        </div>
      )}

      {/* Setup card remains intact */}
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

      {/* Choose operation */}
      <div className="card">
        <h3>{t("choose_operation")}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => startMode(m)} disabled={isSaving}>
              {m.label}
            </button>
          ))}
        </div>

        {!packingReady && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
            {tt(
              "Complete Packing setup (Sheet + OR tab) before running OR-Packing.",
              "Completa la configuración (Hoja + pestaña OR) antes de OR-Packing.",
              "Hoàn tất thiết lập (Sheet + tab OR) trước khi OR-Packing."
            )}
          </div>
        )}
      </div>

      {/* OR-Packing workflow UI */}
      {activeMode === "or-pack" && (
        <div className="card">
          <h3>{tt("OR-Packing", "OR-Empaque", "OR-Đóng gói")}</h3>

          {step === "or_scan1" && (
            <>
              <p>{tt("Scan the first label QR.", "Escanea el primer QR.", "Quét QR thứ nhất.")}</p>
              <div id="or-pack-scan1" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={resetOrPacking} disabled={isSaving}>
                  {tt("Cancel", "Cancelar", "Huỷ")}
                </button>
              </div>
            </>
          )}

          {step === "or_record" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <div>
                  <strong>{tt("Label 1", "Etiqueta 1", "Nhãn 1")}:</strong> {label1}
                </div>
                {rowIndex != null && (
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    <strong>Row:</strong> {rowIndex}
                  </div>
                )}
              </div>

              <PrettyRecord record={record} />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {hasValue(getFieldCI(record, "Packing Date")) || hasValue(getFieldCI(record, "Packing Quantity")) ? (
                  <button className="primary" onClick={openEditPackingForm} disabled={isSaving}>
                    {tt("Edit Packing Form", "Editar formulario", "Sửa form")}
                  </button>
                ) : (
                  <button className="primary" onClick={beginOrPackingScanSecond} disabled={isSaving}>
                    {tt("Packing", "Empacar", "Đóng gói")}
                  </button>
                )}

                <button onClick={resetOrPacking} disabled={isSaving}>
                  {tt("Done", "Listo", "Xong")}
                </button>
              </div>
            </>
          )}

          {step === "or_scan2" && (
            <>
              <p>
                {tt(
                  "Scan the second label QR (must match the same record).",
                  "Escanea el segundo QR (debe coincidir).",
                  "Quét QR thứ hai (phải cùng bản ghi)."
                )}
              </p>
              <div id="or-pack-scan2" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={() => setStep("or_record")} disabled={isSaving}>
                  {tt("Back", "Atrás", "Quay lại")}
                </button>
                <button onClick={resetOrPacking} disabled={isSaving}>
                  {tt("Cancel", "Cancelar", "Huỷ")}
                </button>
              </div>
            </>
          )}

          {step === "or_form" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <div>
                  <strong>{tt("Label 1", "Etiqueta 1", "Nhãn 1")}:</strong> {label1}
                </div>
                {label2 && (
                  <div>
                    <strong>{tt("Label 2", "Etiqueta 2", "Nhãn 2")}:</strong> {label2}
                  </div>
                )}
              </div>

              <h4 style={{ margin: "0 0 10px 0" }}>
                {formMode === "edit"
                  ? tt("Edit Packing Form", "Editar formulario", "Sửa form")
                  : tt("Packing Form", "Formulario de empaque", "Form đóng gói")}
              </h4>

              <div className="grid">
                <label className="field">
                  {tt("Packing Date", "Fecha de empaque", "Ngày đóng gói")}
                  <input type="date" value={packingDate} onChange={(e) => setPackingDate(e.target.value)} />
                </label>

                <label className="field">
                  {tt("Packing Quantity", "Cantidad", "Số lượng")}
                  <input value={packingQty} onChange={(e) => setPackingQty(e.target.value)} placeholder="0" />
                </label>

                <label className="field">
                  {tt("Note (append)", "Nota (agregar)", "Ghi chú (thêm)")}
                  <input
                    value={noteAppend}
                    onChange={(e) => setNoteAppend(e.target.value)}
                    placeholder={tt("Optional…", "Opcional…", "Tuỳ chọn…")}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button className="primary" onClick={saveOrPacking} disabled={isSaving}>
                  {isSaving ? tt("Saving…", "Guardando…", "Đang lưu…") : tt("Save", "Guardar", "Lưu")}
                </button>
                <button onClick={() => setStep("or_record")} disabled={isSaving}>
                  {tt("Back", "Atrás", "Quay lại")}
                </button>
                <button onClick={resetOrPacking} disabled={isSaving}>
                  {tt("Cancel", "Cancelar", "Huỷ")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
