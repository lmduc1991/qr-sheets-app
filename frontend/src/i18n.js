import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadSettings, onSettingsChange, saveSettings } from "./store/settingsStore";

/**
 * Simple i18n system:
 * - language stored in settingsStore (localStorage)
 * - use t("key") in UI
 */

const I18nCtx = createContext({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

const DICT = {
  en: {
    // App / Tabs
    app_title: "QR Sheets App",
    tab_items: "Item Management",
    tab_harvest: "Harvest Management",
    tab_setup: "Setup",

    // Setup
    setup_title: "Setup",
    setup_proxy_title: "1) Proxy URL",
    setup_proxy_label: "Cloudflare Worker URL",
    setup_items_title: "2) Items Sheet (942 - Vine Master Inventory)",
    setup_sheet_link: "Google Sheet link",
    setup_tab_name: "Tab name",
    setup_load_columns: "Load Columns",
    setup_loading: "Loading...",
    setup_key_column: "Key Column (QR contains this value)",
    setup_harvest_title: "3) Harvest Log Sheet (2026 Harvesting Log)",
    setup_save: "Save Setup",
    setup_clear: "Clear Saved Setup",

    // Setup messages/errors
    err_proxy_required: "Proxy URL is required (Cloudflare Worker URL).",
    err_items_link_invalid: "Items Sheet link invalid (cannot find spreadsheet ID).",
    err_items_tab_required: "Items tab name is required.",
    err_harvest_link_invalid: "Harvest Sheet link invalid.",
    err_harvest_tab_required: "Harvest tab name is required.",
    err_key_required: "Key Column is required. Click Load Columns first.",
    msg_columns_loaded: "Columns loaded. Please choose Key Column.",
    msg_cleared: "Cleared saved settings.",

    // Language
    setup_language_title: "Language",
    setup_language_label: "Choose language",
    lang_en: "English",
    lang_vi: "Vietnamese",
    lang_es: "Spanish",

    // Harvest / Alerts
    qr_not_match_scan_another: "QR not match, please scan another",
  },

  vi: {
    // App / Tabs
    app_title: "Ứng dụng QR Sheets",
    tab_items: "Quản lý cây",
    tab_harvest: "Quản lý thu hoạch",
    tab_setup: "Cài đặt",

    // Setup
    setup_title: "Cài đặt",
    setup_proxy_title: "1) Proxy URL",
    setup_proxy_label: "Cloudflare Worker URL",
    setup_items_title: "2) Bảng Items (942 - Vine Master Inventory)",
    setup_sheet_link: "Link Google Sheet",
    setup_tab_name: "Tên tab",
    setup_load_columns: "Tải cột",
    setup_loading: "Đang tải...",
    setup_key_column: "Cột khóa (QR chứa giá trị này)",
    setup_harvest_title: "3) Bảng Harvest Log (2026 Harvesting Log)",
    setup_save: "Lưu cài đặt",
    setup_clear: "Xóa cài đặt đã lưu",

    // Setup messages/errors
    err_proxy_required: "Cần Proxy URL (Cloudflare Worker URL).",
    err_items_link_invalid: "Link Items Sheet không hợp lệ (không tìm thấy spreadsheet ID).",
    err_items_tab_required: "Cần nhập tên tab Items.",
    err_harvest_link_invalid: "Link Harvest Sheet không hợp lệ.",
    err_harvest_tab_required: "Cần nhập tên tab Harvest.",
    err_key_required: "Cần chọn Key Column. Hãy bấm “Tải cột” trước.",
    msg_columns_loaded: "Đã tải danh sách cột. Vui lòng chọn Key Column.",
    msg_cleared: "Đã xóa cài đặt đã lưu.",

    // Language
    setup_language_title: "Ngôn ngữ",
    setup_language_label: "Chọn ngôn ngữ",
    lang_en: "Tiếng Anh",
    lang_vi: "Tiếng Việt",
    lang_es: "Tiếng Tây Ban Nha",

    // Harvest / Alerts
    qr_not_match_scan_another: "QR không khớp, vui lòng quét lại mã khác",
  },

  es: {
    // App / Tabs
    app_title: "Aplicación QR Sheets",
    tab_items: "Gestión de ítems",
    tab_harvest: "Gestión de cosecha",
    tab_setup: "Configuración",

    // Setup
    setup_title: "Configuración",
    setup_proxy_title: "1) URL del Proxy",
    setup_proxy_label: "URL de Cloudflare Worker",
    setup_items_title: "2) Hoja de ítems (942 - Vine Master Inventory)",
    setup_sheet_link: "Enlace de Google Sheet",
    setup_tab_name: "Nombre de la pestaña",
    setup_load_columns: "Cargar columnas",
    setup_loading: "Cargando...",
    setup_key_column: "Columna clave (el QR contiene este valor)",
    setup_harvest_title: "3) Hoja de Harvest Log (2026 Harvesting Log)",
    setup_save: "Guardar configuración",
    setup_clear: "Borrar configuración guardada",

    // Setup messages/errors
    err_proxy_required: "Se requiere la URL del Proxy (Cloudflare Worker URL).",
    err_items_link_invalid: "Enlace de Items Sheet inválido (no se encontró el ID).",
    err_items_tab_required: "Se requiere el nombre de la pestaña de ítems.",
    err_harvest_link_invalid: "Enlace de Harvest Sheet inválido.",
    err_harvest_tab_required: "Se requiere el nombre de la pestaña de cosecha.",
    err_key_required: "Se requiere la columna clave. Haz clic en “Cargar columnas” primero.",
    msg_columns_loaded: "Columnas cargadas. Por favor elige la columna clave.",
    msg_cleared: "Configuración guardada borrada.",

    // Language
    setup_language_title: "Idioma",
    setup_language_label: "Elegir idioma",
    lang_en: "Inglés",
    lang_vi: "Vietnamita",
    lang_es: "Español",

    // Harvest / Alerts
    qr_not_match_scan_another: "El QR no coincide, por favor escanea otro",
  },
};

function safeLang(raw) {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "vi" || v === "vietnamese") return "vi";
  if (v === "es" || v === "spanish") return "es";
  return "en";
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => safeLang(loadSettings()?.language || "en"));

  // update when settings change (cross-page)
  useEffect(() => {
    return onSettingsChange((s) => {
      const next = safeLang(s?.language || "en");
      setLangState(next);
    });
  }, []);

  const setLang = (nextLang) => {
    const fixed = safeLang(nextLang);
    setLangState(fixed);
    // persist immediately
    saveSettings({ language: fixed });
  };

  const t = useMemo(() => {
    const table = DICT[lang] || DICT.en;
    return (key) => table[key] || DICT.en[key] || key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);

  // IMPORTANT: no JSX here (keeps .js valid everywhere)
  return React.createElement(I18nCtx.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nCtx);
}
// Backward-compatible helper: some pages import useT()
export function useT() {
  return useI18n().t;
}
