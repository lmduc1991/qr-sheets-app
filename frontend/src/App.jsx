import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "./App.css";

import SetupPage from "./pages/SetupPage";
import ItemsManagementPage from "./pages/ItemsManagementPage";
import HarvestManagementPage from "./pages/HarvestManagementPage";
import { loadSettings, onSettingsChange } from "./store/settingsStore";
import { useI18n } from "./i18n";

export default function App() {
  const [settings, setSettings] = useState(() => loadSettings());
  const hasSetup = !!settings?.proxyUrl;
  const { t } = useI18n();

  useEffect(() => {
    return onSettingsChange((s) => setSettings(s));
  }, []);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-title">{t("app_title")}</div>

        <nav className="app-tabs">
          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/items">
            {t("tab_items")}
          </NavLink>
          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/harvest">
            {t("tab_harvest")}
          </NavLink>
          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/setup">
            {t("tab_setup")}
          </NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to={hasSetup ? "/items" : "/setup"} replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/items/*" element={hasSetup ? <ItemsManagementPage /> : <Navigate to="/setup" replace />} />
          <Route path="/harvest" element={hasSetup ? <HarvestManagementPage /> : <Navigate to="/setup" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
