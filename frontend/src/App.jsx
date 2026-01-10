import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "./App.css";

import SetupPage from "./pages/SetupPage";
import ItemsManagementPage from "./pages/ItemsManagementPage";
import HarvestManagementPage from "./pages/HarvestManagementPage";
import BinStoragePage from "./pages/BinStoragePage";
import { loadSettings, onSettingsChange } from "./store/settingsStore";

export default function App() {
  // Existing settings logic
  const [settings, setSettings] = useState(() => loadSettings());
  const hasSetup = !!settings?.proxyUrl;

  useEffect(() => {
    return onSettingsChange((s) => setSettings(s));
  }, []);

  // No auth gating. App is accessible immediately.
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-title">QR Sheets App</div>

        <nav className="app-tabs">
          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/items">
            Item Management
          </NavLink>

          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/harvest">
            Harvest Management
          </NavLink>

          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/storage">
            Bin Storage
          </NavLink>

          <NavLink className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")} to="/setup">
            Setup
          </NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to={hasSetup ? "/items" : "/setup"} replace />} />
          <Route path="/setup" element={<SetupPage />} />

          <Route
            path="/items/*"
            element={hasSetup ? <ItemsManagementPage /> : <Navigate to="/setup" replace />}
          />

          <Route
            path="/harvest"
            element={hasSetup ? <HarvestManagementPage /> : <Navigate to="/setup" replace />}
          />

          <Route
            path="/storage"
            element={hasSetup ? <BinStoragePage /> : <Navigate to="/setup" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
