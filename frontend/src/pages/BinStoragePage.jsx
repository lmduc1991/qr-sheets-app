import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { loadSettings, saveSettings, onSettingsChange } from "../store/settingsStore";
import {
  getSheetTabs,
  appendBagStorage,
  appendBinStorage,
  getExistingChildrenForParent,
  findBinForBagLabel,
  removeBinStorageByBagLabels,
} from "../api/sheetsApi";
import { useT } from "../i18n";

// FIX: support /spreadsheets/u/0/d/<ID> too
function extractSpreadsheetId(url) {
  const s = String(url || "").trim();
  const m = s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export default function BinStoragePage() {
  const { t, lang } = useT();
  const tt = (en, es, vi) => (lang === "es" ? es : lang === "vi" ? vi : en);

  const [settings, setSettings] = useState(() => loadSettings() || {});
  useEffect(() => onSettingsChange(setSettings), []);

  const proxyUrl = settings?.proxyUrl || "";

  // ---- Setup state ----
  const [setupOpen, setSetupOpen] = useState(true);
  const [storageUrl, setStorageUrl] = useState(settings?.storageUrl || settings?.storageSheetLink || "");
  const storageSpreadsheetId = useMemo(() => extractSpreadsheetId(storageUrl), [storageUrl]);

  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [setupErr, setSetupErr] = useState("");

  const [bagStorageSheetName, setBagStorageSheetName] = useState(settings?.bagStorageSheetName || "");
  const [binStorageSheetName, setBinStorageSheetName] = useState(settings?.binStorageSheetName || "");

  useEffect(() => {
    setStorageUrl(settings?.storageUrl || settings?.storageSheetLink || "");
    setBagStorageSheetName(settings?.bagStorageSheetName || "");
    setBinStorageSheetName(settings?.binStorageSheetName || "");
  }, [settings?.storageUrl, settings?.storageSheetLink, settings?.bagStorageSheetName, settings?.binStorageSheetName]);

  const storageReady = !!settings?.storageSpreadsheetId && !!settings?.bagStorageSheetName && !!settings?.binStorageSheetName;

  // ---- Operation state ----
  const [op, setOp] = useState("bagToVine"); // bagToVine | binToBag
  const [direction, setDirection] = useState("in"); // in | out

  // Bag -> Vine
  const [bagLabel, setBagLabel] = useState("");
  const [existingVines, setExistingVines] = useState([]);
  const [vineIds, setVineIds] = useState([]);

  // Bin -> Bag
  const [binLabel, setBinLabel] = useState("");
  const [existingBags, setExistingBags] = useState([]);
  const [bagLabels, setBagLabels] = useState([]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // ---- Scanner ----
  const scanBoxId = "storage-reader";
  const scannerRef = useRef(null);
  const [scanTarget, setScanTarget] = useState(null); // bagLabel | vineIds | binLabel | bagLabels

  function clearScannerBox() {
    const el = document.getElementById(scanBoxId);
    if (el) el.innerHTML = "";
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanTarget(null);
    clearScannerBox();
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadExistingForBag(bag) {
    setStatus(t("loading_existing_records"));
    const children = await getExistingChildrenForParent({ mode: "bag", parentLabel: bag });
    setExistingVines(uniq(children));
    setStatus("");
  }

  async function loadExistingForBin(bin) {
    setStatus(t("loading_existing_records"));
    const children = await getExistingChildrenForParent({ mode: "bin", parentLabel: bin });
    setExistingBags(uniq(children));
    setStatus("");
  }

  function startScanner(target) {
    if (scannerRef.current) return;

    setError("");
    setStatus("");
    setScanTarget(target);
    clearScannerBox();

    const qrbox = Math.min(340, Math.floor(window.innerWidth * 0.8));
    const scanner = new Html5QrcodeScanner(
      scanBoxId,
      { fps: 15, qrbox, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
      false
    );

    scanner.render(
      async (decodedText) => {
        const code = String(decodedText || "").trim();
        if (!code) return;

        try {
          // BAG -> VINE
          if (op === "bagToVine") {
            if (target === "bagLabel") {
              setBagLabel(code);
              setVineIds([]);
              setExistingVines([]);
              await loadExistingForBag(code);
              return;
            }

            if (target === "vineIds") {
              if (!bagLabel) {
                alert(tt("Scan bag first.", "Escanee la bolsa primero.", "Quét bag trước."));
                return;
              }

              if (existingVines.includes(code)) {
                alert(`${tt("Record already exists", "El registro ya existe", "Bản ghi đã tồn tại")}: ${code}`);
                return;
              }

              setVineIds((prev) => {
                if (prev.includes(code)) {
                  alert(`${tt("Duplicate scanned", "Escaneo duplicado", "Quét trùng")}: ${code}`);
                  return prev;
                }
                return [...prev, code];
              });
              return;
            }
          }

          // BIN -> BAG
          if (op === "binToBag") {
            if (target === "binLabel") {
              setBinLabel(code);
              setBagLabels([]);
              setExistingBags([]);
              await loadExistingForBin(code);
              return;
            }

            if (target === "bagLabels") {
              if (!binLabel) {
                alert(tt("Scan bin first.", "Escanee el bin primero.", "Quét bin trước."));
                return;
              }

              // block duplicates in current scan
              if (bagLabels.includes(code)) {
                alert(`${tt("Duplicate scanned", "Escaneo duplicado", "Quét trùng")}: ${code}`);
                return;
              }

              if (direction === "in") {
                // Check if this bag is already in some bin
                const r = await findBinForBagLabel({ bagLabel: code });
                if (r.found && r.binLabel && r.binLabel !== binLabel) {
                  alert(
                    `${tt("Bag already exists in bin", "La bolsa ya existe en el bin", "Bag đã tồn tại trong bin")}: ${r.binLabel}`
                  );
                  return;
                }
                if (r.found && r.binLabel === binLabel) {
                  alert(
                    `${tt(
                      "Bag already exists in this bin",
                      "La bolsa ya existe en este bin",
                      "Bag đã tồn tại trong bin này"
                    )}: ${binLabel}`
                  );
                  return;
                }
              } else {
                // OUT: must exist, and must be in this bin
                const r = await findBinForBagLabel({ bagLabel: code });
                if (!r.found) {
                  alert(tt("No existing record for this bag.", "No existe registro para esta bolsa.", "Không có bản ghi cho bag này."));
                  return;
                }
                if (r.binLabel && r.binLabel !== binLabel) {
                  alert(
                    `${tt(
                      "This bag is not in the scanned bin. Current bin",
                      "Esta bolsa no está en el bin escaneado. Bin actual",
                      "Bag không nằm trong bin đã quét. Bin hiện tại"
                    )}: ${r.binLabel}`
                  );
                  return;
                }
              }

              setBagLabels((prev) => [...prev, code]);
              return;
            }
          }
        } catch (e) {
          setStatus("");
          setError(e?.message || String(e));
        }
      },
      () => {}
    );

    scannerRef.current = scanner;
  }

  function resetAll() {
    stopScanner();
    setStatus("");
    setError("");

    setBagLabel("");
    setExistingVines([]);
    setVineIds([]);

    setBinLabel("");
    setExistingBags([]);
    setBagLabels([]);
  }

  // ---- Setup actions ----
  const loadTabs = async () => {
    setSetupErr("");
    setSetupMsg("");

    if (!proxyUrl.trim()) return setSetupErr(t("proxy_missing_go_setup"));
    if (!storageSpreadsheetId)
      return setSetupErr(
        tt(
          "Storage sheet link invalid (cannot find spreadsheet ID).",
          "Enlace de Storage inválido (no se puede encontrar el ID).",
          "Link Storage không hợp lệ (không tìm thấy spreadsheet ID)."
        )
      );

    setTabsLoading(true);
    try {
      const tbs = await getSheetTabs(storageSpreadsheetId);
      setTabs(tbs);
      setSetupMsg(t("tabs_loaded_choose"));
    } catch (e) {
      setSetupErr(e.message || t("failed_load_columns"));
    } finally {
      setTabsLoading(false);
    }
  };

  const saveStorageSetup = () => {
    setSetupErr("");
    setSetupMsg("");

    if (!proxyUrl.trim()) return setSetupErr(t("proxy_missing_go_setup"));
    if (!storageSpreadsheetId)
      return setSetupErr(
        tt(
          "Storage sheet link invalid (cannot find spreadsheet ID).",
          "Enlace de Storage inválido (no se puede encontrar el ID).",
          "Link Storage không hợp lệ (không tìm thấy spreadsheet ID)."
        )
      );

    if (!bagStorageSheetName.trim() || !binStorageSheetName.trim()) {
      return setSetupErr(t("storage_setup_missing"));
    }

    saveSettings({
      storageUrl,
      storageSpreadsheetId,
      bagStorageSheetName: bagStorageSheetName.trim(),
      binStorageSheetName: binStorageSheetName.trim(),
    });

    setSetupMsg(t("storage_settings_saved"));
    setSetupOpen(false);
  };

  // ---- Save actions ----
  async function saveBagToVine() {
    setError("");
    setStatus("");

    if (!storageReady) return setError(t("storage_setup_missing"));
    if (!bagLabel) return setError(t("scan_bag_first"));

    const vines = uniq(vineIds);
    if (!vines.length) return setError(tt("Scan at least 1 vine.", "Escanee al menos 1 vid.", "Quét ít nhất 1 vine."));

    setBusy(true);
    setStatus(t("saving_to_sheet"));
    try {
      // safety: re-check existing for bag before write
      const existing = uniq(await getExistingChildrenForParent({ mode: "bag", parentLabel: bagLabel }));
      const existingSet = new Set(existing);
      const toWrite = vines.filter((v) => !existingSet.has(v));

      if (!toWrite.length) {
        alert(
          tt(
            "All scanned vines already exist for this bag.",
            "Todas las vides ya existen para esta bolsa.",
            "Tất cả vine đã tồn tại cho bag này."
          )
        );
        return;
      }

      await appendBagStorage({ bagLabel, vineIds: toWrite });

      alert(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      resetAll();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function saveBinToBag() {
    setError("");
    setStatus("");

    if (!storageReady) return setError(t("storage_setup_missing"));
    if (!binLabel) return setError(t("scan_bin_first"));

    const bags = uniq(bagLabels);
    if (!bags.length) return setError(tt("Scan at least 1 bag.", "Escanee al menos 1 bolsa.", "Quét ít nhất 1 bag."));

    setBusy(true);
    setStatus(t("saving_to_sheet"));
    try {
      if (direction === "in") {
        // final validation: block bags already in another bin
        const safe = [];
        for (const b of bags) {
          const r = await findBinForBagLabel({ bagLabel: b });
          if (r.found && r.binLabel && r.binLabel !== binLabel) {
            alert(`${tt("Bag already exists in bin", "La bolsa ya existe en el bin", "Bag đã tồn tại trong bin")}: ${r.binLabel}\n${b}`);
            continue;
          }
          if (r.found && r.binLabel === binLabel) {
            alert(
              `${tt(
                "Bag already exists in this bin",
                "La bolsa ya existe en este bin",
                "Bag đã tồn tại trong bin này"
              )}: ${binLabel}\n${b}`
            );
            continue;
          }
          safe.push(b);
        }

        if (!safe.length) return;

        await appendBinStorage({ binLabel, bagLabels: safe });
        alert(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      } else {
        // OUT
        const r = await removeBinStorageByBagLabels({ binLabel, bagLabels: bags });
        if (r.notFound?.length) {
          alert(`${tt("Not found:", "No encontrado:", "Không tìm thấy:")}\n${r.notFound.join("\n")}`);
        }
        alert(`${tt("Removed:", "Eliminado:", "Đã xóa:")} ${r.removed}`);
      }

      resetAll();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  if (!proxyUrl) return <div className="page">{t("please_go_setup_first")}</div>;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h2>{t("tab_storage")}</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {status && <div className="alert alert-ok">{status}</div>}

      {/* Setup */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>
            {tt("Bin Storage Sheet Setup", "Configuración de Bin Storage", "Thiết lập Bin Storage")}
          </div>
          <button onClick={() => setSetupOpen((v) => !v)}>{setupOpen ? t("close") : t("storage_settings")}</button>
        </div>

        {setupOpen && (
          <div style={{ marginTop: 12 }}>
            {setupErr && <div className="alert alert-error">{setupErr}</div>}
            {setupMsg && <div className="alert alert-ok">{setupMsg}</div>}

            <label className="field">
              {tt("Google Sheet link", "Enlace de Google Sheet", "Link Google Sheet")}
              <input
                value={storageUrl}
                onChange={(e) => setStorageUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={loadTabs} disabled={tabsLoading}>
                {tabsLoading ? t("loading") : t("load_tabs")}
              </button>
            </div>

            {tabs.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <label className="field">
                  {tt("Bag scan tab", "Pestaña de bag scan", "Tab bag scan")}
                  <select value={bagStorageSheetName} onChange={(e) => setBagStorageSheetName(e.target.value)}>
                    <option value="">{tt("Select tab", "Seleccione", "Chọn tab")}</option>
                    {tabs.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  {tt("Bin scan tab", "Pestaña de bin scan", "Tab bin scan")}
                  <select value={binStorageSheetName} onChange={(e) => setBinStorageSheetName(e.target.value)}>
                    <option value="">{tt("Select tab", "Seleccione", "Chọn tab")}</option>
                    {tabs.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button onClick={saveStorageSetup}>{t("save_storage_setup")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Operation select */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontWeight: 700 }}>{tt("Operation", "Operación", "Thao tác")}</span>
            <select
              value={op}
              onChange={(e) => {
                setOp(e.target.value);
                resetAll();
              }}
            >
              <option value="bagToVine">{tt("Bag → Vine", "Bolsa → Vid", "Bag → Vine")}</option>
              <option value="binToBag">{tt("Bin → Bag", "Bin → Bolsa", "Bin → Bag")}</option>
            </select>
          </label>

          {op === "binToBag" && (
            <label className="field" style={{ margin: 0 }}>
              <span style={{ fontWeight: 700 }}>{tt("Direction", "Dirección", "Hướng")}</span>
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  setBagLabels([]);
                }}
              >
                <option value="in">{t("in")}</option>
                <option value="out">{t("out")}</option>
              </select>
            </label>
          )}

          <button onClick={resetAll}>{t("reset")}</button>
        </div>
      </div>

      {/* Scanner */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {op === "bagToVine" ? (
            <>
              <button onClick={() => startScanner("bagLabel")} disabled={busy}>
                {tt("Scan BAG label", "Escanear BAG", "Quét BAG")}
              </button>
              <button onClick={() => startScanner("vineIds")} disabled={busy}>
                {tt("Bulk scan VINE labels", "Escaneo masivo VINE", "Quét nhiều VINE")}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => startScanner("binLabel")} disabled={busy}>
                {tt("Scan BIN label", "Escanear BIN", "Quét BIN")}
              </button>
              <button onClick={() => startScanner("bagLabels")} disabled={busy}>
                {direction === "in"
                  ? tt("Bulk scan BAG labels", "Escaneo masivo BAG", "Quét nhiều BAG")
                  : tt("Scan BAG labels to remove", "Escanear BAG para eliminar", "Quét BAG để xóa")}
              </button>
            </>
          )}

          <button onClick={stopScanner}>{tt("Stop scanner", "Detener escáner", "Dừng quét")}</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div id={scanBoxId} />
        </div>
      </div>

      {/* Panels */}
      <div className="card">
        {op === "bagToVine" ? (
          <>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>{tt("Bag → Vine", "Bolsa → Vid", "Bag → Vine")}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{tt("Bag label", "Etiqueta de bolsa", "Mã bag")}</div>
                <div style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6, minHeight: 40 }}>
                  {bagLabel || <span style={{ opacity: 0.6 }}>{tt("Not scanned yet", "Aún no escaneado", "Chưa quét")}</span>}
                </div>

                {existingVines.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("existing_records")}</div>
                    <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                      {existingVines.map((x) => (
                        <div key={x} style={{ fontFamily: "monospace" }}>{x}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {tt("Scanned vine labels", "Vides escaneadas", "Vine đã quét")}
                </div>
                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                  {vineIds.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>{tt("No scans yet.", "Sin escaneos.", "Chưa có quét.")}</div>
                  ) : (
                    vineIds.map((c) => (
                      <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "4px 0" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{c}</span>
                        <button onClick={() => setVineIds((prev) => prev.filter((x) => x !== c))} style={{ padding: "2px 8px" }}>
                          {t("remove")}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={saveBagToVine} disabled={busy || !bagLabel || vineIds.length === 0}>
                {busy ? t("saving_to_sheet") : t("save_to_sheet")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>{tt("Bin → Bag", "Bin → Bolsa", "Bin → Bag")}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{tt("Bin label", "Etiqueta de bin", "Mã bin")}</div>
                <div style={{ padding: 8, border: "1px solid #ddd", borderRadius: 6, minHeight: 40 }}>
                  {binLabel || <span style={{ opacity: 0.6 }}>{tt("Not scanned yet", "Aún no escaneado", "Chưa quét")}</span>}
                </div>

                {existingBags.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {tt("Existing bags in this bin", "Bolsas existentes en este bin", "Bag hiện có trong bin")}
                    </div>
                    <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                      {existingBags.map((x) => (
                        <div key={x} style={{ fontFamily: "monospace" }}>{x}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {direction === "in"
                    ? tt("Scanned bag labels", "Bolsas escaneadas", "Bag đã quét")
                    : tt("Bag labels to remove", "Bolsas a eliminar", "Bag cần xóa")}
                </div>

                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                  {bagLabels.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>{tt("No scans yet.", "Sin escaneos.", "Chưa có quét.")}</div>
                  ) : (
                    bagLabels.map((c) => (
                      <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "4px 0" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{c}</span>
                        <button onClick={() => setBagLabels((prev) => prev.filter((x) => x !== c))} style={{ padding: "2px 8px" }}>
                          {t("remove")}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={saveBinToBag} disabled={busy || !binLabel || bagLabels.length === 0}>
                {busy ? t("saving_to_sheet") : t("save_to_sheet")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
