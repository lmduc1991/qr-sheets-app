import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import ItemScanPage from "./ItemScanPage";
import ItemBulkScanPage from "./ItemBulkScanPage";
import { useT } from "../i18n";

export default function ItemsManagementPage() {
  // useT() returns the translation function directly
  const t = useT();

  return (
    <div className="page">
      <h2>{t("items_title")}</h2>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <NavLink to="/items/scan" style={{ textDecoration: "none" }}>
          {({ isActive }) => <button className={isActive ? "primary" : ""}>{t("scan")}</button>}
        </NavLink>

        <NavLink to="/items/bulk" style={{ textDecoration: "none" }}>
          {({ isActive }) => <button className={isActive ? "primary" : ""}>{t("bulk_scan")}</button>}
        </NavLink>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="scan" replace />} />
        <Route path="scan" element={<ItemScanPage />} />
        <Route path="bulk" element={<ItemBulkScanPage />} />
      </Routes>
    </div>
  );
}
