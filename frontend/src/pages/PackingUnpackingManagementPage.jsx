import { useMemo, useState } from "react";
import { loadSettings, saveSettings } from "../store/settingsStore";
import { getSheetTabs } from "../api/sheetsApi";
import { useT } from "../i18n";

function extractSpreadsheetId(url) {
  const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : "";
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

  const base = useMemo(() => loadSettings(), []);
  const proxyUrl = base?.proxyUrl || "";

  const [packingUrl, setPackingUrl] = useState(base?.packingUrl || "");
  const [orSheetName, setOrSheetName] = useState(base?.packingOrSheetName || "");
  const [graftingSheetName, setGraftingSheetName] = useState(base?.packingGraftingSheetName || "");

  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const packingSpreadsheetId = extractSpreadsheetId(packingUrl);

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

  const start = (m) => {
    if (!ensureTabForMode(m.needs)) return;
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

      <div className="card">
        <h3>{t("choose_operation")}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => start(m)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
