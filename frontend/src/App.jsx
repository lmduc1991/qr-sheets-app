import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import netlifyIdentity from "netlify-identity-widget";
import "./App.css";

import SetupPage from "./pages/SetupPage";
import ItemsManagementPage from "./pages/ItemsManagementPage";
import HarvestManagementPage from "./pages/HarvestManagementPage";
import { loadSettings, onSettingsChange } from "./store/settingsStore";

export default function App() {
  // ---------------------------
  // Existing settings logic
  // ---------------------------
  const [settings, setSettings] = useState(() => loadSettings());
  const hasSetup = !!settings?.proxyUrl;

  useEffect(() => {
    return onSettingsChange((s) => setSettings(s));
  }, []);

  // ---------------------------
  // Netlify Identity logic
  // ---------------------------
  const [user, setUser] = useState(() => netlifyIdentity.currentUser());

  useEffect(() => {
    netlifyIdentity.on("login", (u) => setUser(u));
    netlifyIdentity.on("logout", () => setUser(null));

    return () => {
      netlifyIdentity.off("login");
      netlifyIdentity.off("logout");
    };
  }, []);

  // ---------------------------
  // If NOT logged in → block app
  // ---------------------------
  if (!user) {
    return (
      <div className="app-layout">
        <header className="app-header">
          <div className="app-title">QR Sheets App</div>
          <button
            onClick={() => netlifyIdentity.open("login")}
            className="login-btn"
          >
            Login
          </button>
        </header>

        <main className="app-main">
          <p>Please log in to use this application.</p>
        </main>
      </div>
    );
  }

  // ---------------------------
  // Logged-in app
  // ---------------------------
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-title">QR Sheets App</div>

        <nav className="app-tabs">
          <NavLink
            className={({ isActive }) =>
              "tab" + (isActive ? " tab-active" : "")
            }
            to="/items"
          >
            Item Management
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              "tab" + (isActive ? " tab-active" : "")
            }
            to="/harvest"
          >
            Harvest Management
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              "tab" + (isActive ? " tab-active" : "")
            }
            to="/setup"
          >
            Setup
          </NavLink>
        </nav>

        <div className="login-status">
          <span className="login-email">{user.email}</span>
          <button
            onClick={() => netlifyIdentity.logout()}
            className="logout-btn"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={<Navigate to={hasSetup ? "/items" : "/setup"} replace />}
          />
          <Route path="/setup" element={<SetupPage />} />
          <Route
            path="/items/*"
            element={
              hasSetup ? <ItemsManagementPage /> : <Navigate to="/setup" replace />
            }
          />
          <Route
            path="/harvest"
            element={
              hasSetup ? (
                <HarvestManagementPage />
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
