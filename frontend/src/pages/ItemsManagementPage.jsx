import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import ItemScanPage from "./ItemScanPage";
import ItemBulkScanPage from "./ItemBulkScanPage";

export default function ItemsManagementPage() {
  return (
    <div className="page">
      <h2>Item Management</h2>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <NavLink to="/items/scan" style={{ textDecoration: "none" }}>
          {({ isActive }) => <button className={isActive ? "primary" : ""}>Scan</button>}
        </NavLink>

        <NavLink to="/items/bulk" style={{ textDecoration: "none" }}>
          {({ isActive }) => <button className={isActive ? "primary" : ""}>Bulk Scan</button>}
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
