// src/pages/BinStoragePage.jsx
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

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
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
  const { t, tt } = useT();

  const [settings, setSettings] = useState(loadSettings() || {});
  useEffect(() => onSettingsChange(setSettings), []);

  // -------------------- Setup UI --------------------
  const [setupOpen, setSetupOpen] = useState(true);
  const [sheetLink, setSheetLink] = useState(settings.storageSheetLink || "");
  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(false);

  const [bagTab, setBagTab] = useState(settings.bagStorageSheetName || "bag scan");
  const [binTab, setBinTab] = useState(settings.binStorageSheetName || "bin scan");

  // -------------------- Operation UI --------------------
  const [op, setOp] = useState("bagToVine"); // "bagToVine" | "binToBag"
  const [direction, setDirection] = useState("in"); // for binToBag: "in" | "out"

  // Bag -> Vine
  const [bagLabel, setBagLabel] = useState("");
  const [existingVinesForBag, setExistingVinesForBag] = useState([]);
  const [vineIdsScanned, setVineIdsScanned] = useState([]);

  // Bin -> Bag
  const [binLabel, setBinLabel] = useState("");
  const [existingBagsForBin, setExistingBagsForBin] = useState([]);
  const [bagLabelsScanned, setBagLabelsScanned] = useState([]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // -------------------- Scanner --------------------
  const scannerRef = useRef(null);
  const scanBoxId = "binStorageScannerBox";
  const [scanTarget, setScanTarget] = useState(null); // "bagLabel" | "vineIds" | "binLabel" | "bagLabels"
  const [scannerOn, setScannerOn] = useState(false);

  const storageReady = useMemo(() => {
    return !!settings?.proxyUrl && !!settings?.storageSpreadsheetId && !!settings?.bagStorageSheetName && !!settings?.binStorageSheetName;
  }, [settings]);

  function stopScanner() {
    if (scannerRef.current) {
      try {
        scannerRef.current.clear?.();
      } catch {}
      scannerRef.current = null;
    }
    setScannerOn(false);
    setScanTarget(null);
  }

  function startScanner(target) {
    stopScanner();
    setStatus("");
    setScanTarget(target);

    // Html5QrcodeScanner renders UI into element; must exist
    const el = document.getElementById(scanBoxId);
    if (!el) return;

    const scanner = new Html5QrcodeScanner(
      scanBoxId,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scannerRef.current = scanner;

    scanner.render(
      (decodedText) => {
        const code = String(decodedText || "").trim();
        if (!code) return;
        onScanned(code, target);
      },
      () => {}
    );

    setScannerOn(true);
  }

  useEffect(() => {
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------- Scan handlers --------------------
  async function onScanned(code, target) {
    // Avoid rapid re-add when the scanner fires multiple times
    // We do not fully stop the scanner (bulk scan); we just de-dup.
    if (op === "bagToVine") {
      if (target === "bagLabel") {
        const nextBag = code;
        setBagLabel(nextBag);
        setVineIdsScanned([]);
        setExistingVinesForBag([]);
        setStatus("");

        // Load existing for duplicate prevention
        try {
          setStatus(t("loading_existing_records"));
          const children = await getExistingChildrenForParent({ mode: "bag", parentLabel: nextBag });
          setExistingVinesForBag(uniq(children));
          setStatus("");
        } catch (e) {
          setStatus(e?.message || String(e));
        }
        return;
      }

      if (target === "vineIds") {
        if (!bagLabel) {
          alert(t("scan_bag_first"));
          return;
        }

        const existsInThisBag = new Set(existingVinesForBag);
        const alreadyScanned = new Set(vineIdsScanned);

        if (existsInThisBag.has(code)) {
          alert(`${tt("Record already exists", "El registro ya existe", "Bản ghi đã tồn tại")}: ${code}`);
          return;
        }
        if (alreadyScanned.has(code)) {
          alert(`${tt("Duplicate scanned", "Escaneo duplicado", "Quét trùng")}: ${code}`);
          return;
        }

        setVineIdsScanned((prev) => uniq([...prev, code]));
        return;
      }
    }

    if (op === "binToBag") {
      if (target === "binLabel") {
        const nextBin = code;
        setBinLabel(nextBin);
        setBagLabelsScanned([]);
        setExistingBagsForBin([]);
        setStatus("");

        try {
          setStatus(t("loading_existing_records"));
          const children = await getExistingChildrenForParent({ mode: "bin", parentLabel: nextBin });
          setExistingBagsForBin(uniq(children));
          setStatus("");
        } catch (e) {
          setStatus(e?.message || String(e));
        }
        return;
      }

      if (target === "bagLabels") {
        if (!binLabel) {
          alert(t("scan_bin_first"));
          return;
        }

        const alreadyScanned = new Set(bagLabelsScanned);
        if (alreadyScanned.has(code)) {
          alert(`${tt("Duplicate scanned", "Escaneo duplicado", "Quét trùng")}: ${code}`);
          return;
        }

        // Direction-specific duplicate logic
        if (direction === "in") {
          // If bag already in ANY bin, warn and block.
          try {
            const r = await findBinForBagLabel({ bagLabel: code });
            if (r.found && r.binLabel && r.binLabel !== binLabel) {
              alert(
                `${tt("Bag already exists in bin", "La bolsa ya existe en el bin", "Bag đã tồn tại trong bin")}: ${r.binLabel}`
              );
              return;
            }
            if (r.found && r.binLabel === binLabel) {
              alert(
                `${tt("Bag already exists in this bin", "La bolsa ya existe en este bin", "Bag đã tồn tại trong bin này")}: ${binLabel}`
              );
              return;
            }
          } catch (e) {
            // If backend doesn't support this action, we still allow scan,
            // but show a status warning (so user knows duplicate check may be incomplete).
            setStatus(
              `${tt(
                "Warning: cannot check bag location (missing API).",
                "Advertencia: no se puede verificar la ubicación de la bolsa (API faltante).",
                "Cảnh báo: không thể kiểm tra vị trí bag (thiếu API)."
              )} ${e?.message || ""}`
            );
          }

          setBagLabelsScanned((prev) => uniq([...prev, code]));
          return;
        }

        // OUT
        if (direction === "out") {
          try {
            const r = await findBinForBagLabel({ bagLabel: code });
            if (!r.found) {
              alert(tt("No existing record for this bag", "No existe registro para esta bolsa", "Không có bản ghi cho bag này"));
              return;
            }
            if (r.binLabel && r.binLabel !== binLabel) {
              alert(
                `${tt("This bag is not in the scanned bin. Current bin", "Esta bolsa no está en el bin escaneado. Bin actual", "Bag không nằm trong bin đã quét. Bin hiện tại")}: ${r.binLabel}`
              );
              return;
            }
          } catch (e) {
            setStatus(
              `${tt(
                "Warning: cannot validate OUT lookup (missing API).",
                "Advertencia: no se puede validar OUT (API faltante).",
                "Cảnh báo: không thể kiểm tra OUT (thiếu API)."
              )} ${e?.message || ""}`
            );
          }

          setBagLabelsScanned((prev) => uniq([...prev, code]));
          return;
        }
      }
    }
  }

  // -------------------- Save actions --------------------
  async function saveBagToVine() {
    const vines = uniq(vineIdsScanned);
    if (!bagLabel) return alert(t("scan_bag_first"));
    if (!vines.length) return alert(tt("Scan at least 1 vine", "Escanee al menos 1 vid", "Quét ít nhất 1 vine"));

    setBusy(true);
    setStatus(t("saving_to_sheet"));
    try {
      // Final de-dup safety against existing children (for this bag)
      let existing = [];
      try {
        existing = uniq(await getExistingChildrenForParent({ mode: "bag", parentLabel: bagLabel }));
      } catch {
        existing = [];
      }
      const existingSet = new Set(existing);
      const toWrite = vines.filter((v) => !existingSet.has(v));
      if (!toWrite.length) {
        alert(tt("All scanned vines already exist for this bag.", "Todas las vides ya existen para esta bolsa.", "Tất cả vine đã tồn tại cho bag này."));
        return;
      }

      await appendBagStorage({ bagLabel, vineIds: toWrite });

      alert(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      // Reset to ready state
      setBagLabel("");
      setExistingVinesForBag([]);
      setVineIdsScanned([]);
      setScanTarget(null);
      setStatus("");
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function saveBinToBag() {
    const bags = uniq(bagLabelsScanned);
    if (!binLabel) return alert(t("scan_bin_first"));
    if (!bags.length) return alert(tt("Scan at least 1 bag", "Escanee al menos 1 bolsa", "Quét ít nhất 1 bag"));

    setBusy(true);
    setStatus(t("saving_to_sheet"));
    try {
      if (direction === "in") {
        // Final check: block any bags already in another bin
        const safeToWrite = [];
        for (const b of bags) {
          try {
            const r = await findBinForBagLabel({ bagLabel: b });
            if (r.found && r.binLabel && r.binLabel !== binLabel) {
              alert(`${tt("Bag already exists in bin", "La bolsa ya existe en el bin", "Bag đã tồn tại trong bin")}: ${r.binLabel}\n${b}`);
              continue;
            }
            if (r.found && r.binLabel === binLabel) {
              alert(`${tt("Bag already exists in this bin", "La bolsa ya existe en este bin", "Bag đã tồn tại trong bin này")}: ${binLabel}\n${b}`);
              continue;
            }
          } catch {
            // If API missing, we can't validate—still allow append (user requested, but best effort)
          }
          safeToWrite.push(b);
        }

        if (!safeToWrite.length) return;

        await appendBinStorage({ binLabel, bagLabels: safeToWrite });
        alert(tt("Saved successfully.", "Guardado con éxito.", "Lưu thành công."));
      } else {
        // OUT: remove
        const r = await removeBinStorageByBagLabels({ binLabel, bagLabels: bags });
        if (r.notFound?.length) {
          alert(
            `${tt("Not found:", "No encontrado:", "Không tìm thấy:")}\n` + r.notFound.join("\n")
          );
        }
        alert(
          `${tt("Removed:", "Eliminado:", "Đã xóa:")} ${r.removed}`
        );
      }

      // Reset to ready state
      setBinLabel("");
      setExistingBagsForBin([]);
      setBagLabelsScanned([]);
      setScanTarget(null);
      setStatus("");
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  // -------------------- Setup actions --------------------
  async function loadTabs() {
    const spreadsheetId = extractSpreadsheetId(sheetLink);
    if (!spreadsheetId) {
      alert(tt("Invalid Google Sheet link.", "Enlace de Google Sheet inválido.", "Link Google Sheet không hợp lệ."));
      return;
    }
    setTabsLoading(true);
    setStatus(t("loading"));
    try {
      const r = await getSheetTabs({ spreadsheetId });
      const list = Array.isArray(r?.tabs) ? r.tabs : [];
      setTabs(list);
      setStatus(t("tabs_loaded_choose"));
    } catch (e) {
      setStatus(e?.message || String(e));
    } finally {
      setTabsLoading(false);
    }
  }

  function saveStorageSetup() {
    const spreadsheetId = extractSpreadsheetId(sheetLink);
    if (!spreadsheetId) {
      alert(tt("Invalid Google Sheet link.", "Enlace de Google Sheet inválido.", "Link Google Sheet không hợp lệ."));
      return;
    }
    if (!bagTab || !binTab) {
      alert(tt("Please select both tabs.", "Seleccione ambas pestañas.", "Vui lòng chọn cả 2 tab."));
      return;
    }

    saveSettings({
      storageSheetLink: sheetLink,
      storageSpreadsheetId: spreadsheetId,
      bagStorageSheetName: bagTab,
      binStorageSheetName: binTab,
    });

    alert(t("storage_settings_saved"));
    setSetupOpen(false);
  }

  // -------------------- Render helpers --------------------
  const canSave =
    !busy &&
    ((op === "bagToVine" && bagLabel && vineIdsScanned.length > 0) ||
      (op === "binToBag" && binLabel && bagLabelsScanned.length > 0));

  const sheetSetupWarning = !settings?.proxyUrl
    ? tt("Please set Proxy URL first in Setup.", "Primero configure la URL Proxy en Setup.", "Vui lòng cài Proxy URL trong Setup.")
    : !storageReady
    ? t("storage_setup_missing")
    : "";

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h2>{t("storage_title")}</h2>

      {sheetSetupWarning && (
        <div className="card" style={{ marginBottom: 10, border: "1px solid #b00" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {tt("Setup required", "Se requiere configuración", "Cần thiết lập")}
          </div>
          <div>{sheetSetupWarning}</div>
        </div>
      )}

      {/* Setup */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>{t("storage_setup_title")}</div>
          <button onClick={() => setSetupOpen((v) => !v)}>{setupOpen ? t("close") : t("storage_settings")}</button>
        </div>

        {setupOpen && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("storage_sheet_link")}</div>
              <input
                value={sheetLink}
                onChange={(e) => setSheetLink(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <button onClick={loadTabs} disabled={tabsLoading}>
                {tabsLoading ? t("loading") : t("load_tabs")}
              </button>
              <div style={{ opacity: 0.8 }}>{status}</div>
            </div>

            {tabs?.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "block" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("bag_scans_tab")}</div>
                  <select value={bagTab} onChange={(e) => setBagTab(e.target.value)} style={{ width: "100%" }}>
                    {tabs.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "block" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("bin_scans_tab")}</div>
                  <select value={binTab} onChange={(e) => setBinTab(e.target.value)} style={{ width: "100%" }}>
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

      {/* Operation selector */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>{tt("Operation", "Operación", "Thao tác")}</span>
            <select
              value={op}
              onChange={(e) => {
                stopScanner();
                setStatus("");
                setOp(e.target.value);
                setBagLabel("");
                setExistingVinesForBag([]);
                setVineIdsScanned([]);
                setBinLabel("");
                setExistingBagsForBin([]);
                setBagLabelsScanned([]);
              }}
            >
              <option value="bagToVine">{tt("Bag → Vine", "Bolsa → Vid", "Bag → Vine")}</option>
              <option value="binToBag">{tt("Bin → Bag", "Bin → Bolsa", "Bin → Bag")}</option>
            </select>
          </label>

          {op === "binToBag" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>{tt("Direction", "Dirección", "Hướng")}</span>
              <select
                value={direction}
                onChange={(e) => {
                  stopScanner();
                  setDirection(e.target.value);
                  setBagLabelsScanned([]);
                  setStatus("");
                }}
              >
                <option value="in">{t("in")}</option>
                <option value="out">{t("out")}</option>
              </select>
            </label>
          )}

          <button
            onClick={() => {
              // reset operation state
              stopScanner();
              setStatus("");
              setBagLabel("");
              setExistingVinesForBag([]);
              setVineIdsScanned([]);
              setBinLabel("");
              setExistingBagsForBin([]);
              setBagLabelsScanned([]);
            }}
          >
            {t("reset")}
          </button>
        </div>
      </div>

      {/* Scanner box */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>{tt("Scanner", "Escáner", "Quét")}</div>
          <div style={{ opacity: 0.85 }}>{status}</div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {op === "bagToVine" && (
            <>
              <button onClick={() => startScanner("bagLabel")} disabled={busy}>
                {tt("Start scan BAG label", "Iniciar escaneo etiqueta BAG", "Quét BAG")}
              </button>
              <button onClick={() => startScanner("vineIds")} disabled={busy}>
                {tt("Start bulk scan VINE labels", "Escaneo masivo etiquetas VINE", "Quét nhiều VINE")}
              </button>
            </>
          )}

          {op === "binToBag" && (
            <>
              <button onClick={() => startScanner("binLabel")} disabled={busy}>
                {tt("Start scan BIN label", "Iniciar escaneo etiqueta BIN", "Quét BIN")}
              </button>
              <button onClick={() => startScanner("bagLabels")} disabled={busy}>
                {direction === "in"
                  ? tt("Start bulk scan BAG labels", "Escaneo masivo etiquetas BAG", "Quét nhiều BAG")
                  : tt("Scan BAG labels to remove", "Escanear bolsas para eliminar", "Quét BAG để xóa")}
              </button>
            </>
          )}

          <button onClick={stopScanner} disabled={!scannerOn}>
            {tt("Stop scanner", "Detener escáner", "Dừng quét")}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div id={scanBoxId} />
        </div>
      </div>

      {/* Operation panel */}
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

                {!!existingVinesForBag.length && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("existing_records")}</div>
                    <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                      {existingVinesForBag.map((x) => (
                        <div key={x} style={{ fontFamily: "monospace" }}>
                          {x}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {tt("Vine labels scanned (bulk)", "Vides escaneadas (masivo)", "Vine đã quét (nhiều)")}
                </div>

                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                  {vineIdsScanned.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>{tt("No scans yet.", "Sin escaneos.", "Chưa có quét.")}</div>
                  ) : (
                    vineIdsScanned.map((c) => (
                      <div
                        key={c}
                        style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "4px 0" }}
                      >
                        <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{c}</span>
                        <button
                          onClick={() => setVineIdsScanned((prev) => prev.filter((x) => x !== c))}
                          style={{ padding: "2px 8px" }}
                        >
                          {t("remove")}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={saveBagToVine} disabled={!canSave}>
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

                {!!existingBagsForBin.length && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {tt("Existing bags in this bin", "Bolsas existentes en este bin", "Bag hiện có trong bin")}
                    </div>
                    <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                      {existingBagsForBin.map((x) => (
                        <div key={x} style={{ fontFamily: "monospace" }}>
                          {x}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {direction === "in"
                    ? tt("Bag labels scanned (bulk)", "Bolsas escaneadas (masivo)", "Bag đã quét (nhiều)")
                    : tt("Bag labels to remove", "Bolsas a eliminar", "Bag cần xóa")}
                </div>

                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                  {bagLabelsScanned.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>{tt("No scans yet.", "Sin escaneos.", "Chưa có quét.")}</div>
                  ) : (
                    bagLabelsScanned.map((c) => (
                      <div
                        key={c}
                        style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "4px 0" }}
                      >
                        <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{c}</span>
                        <button
                          onClick={() => setBagLabelsScanned((prev) => prev.filter((x) => x !== c))}
                          style={{ padding: "2px 8px" }}
                        >
                          {t("remove")}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={saveBinToBag} disabled={!canSave}>
                {busy ? t("saving_to_sheet") : t("save_to_sheet")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
