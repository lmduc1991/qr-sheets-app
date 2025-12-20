// src/pages/ItemHistoryPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getItemHistory } from "../api";

const ACTION_COLORS = {
  CREATE: "#28a745",
  UPDATE: "#007bff",
  DELETE: "#dc3545",
};

export default function ItemHistoryPage() {
  const { itemId } = useParams();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [actionFilter, setActionFilter] = useState("ALL");
  const [showSystem, setShowSystem] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");

    getItemHistory(itemId)
      .then((data) => {
        if (!alive) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || "Failed to load history");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [itemId]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!showSystem && r.is_system) return false;
      if (actionFilter === "ALL") return true;
      return r.action === actionFilter;
    });
  }, [rows, actionFilter, showSystem]);

  if (loading)
    return (
      <div className="page history-page">
        <p>Loading history…</p>
      </div>
    );

  if (error)
    return (
      <div className="page history-page">
        <p style={{ color: "red" }}>{error}</p>
      </div>
    );

  return (
    <div className="page history-page" style={{ maxWidth: 900 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => navigate("/items")}
          style={btnGray}
          title="Back to items"
        >
          ← Back
        </button>

        <h2 style={{ margin: 0 }}>History: {itemId}</h2>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
          padding: 8,
          border: "1px solid #eee",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <label style={{ fontSize: "0.9rem" }}>
          Action:{" "}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="ALL">All</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>

        <label style={{ fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Show system changes
        </label>

        <div style={{ marginLeft: "auto", fontSize: "0.9rem" }}>
          Total events: <strong>{filteredRows.length}</strong>
        </div>
      </div>

      {filteredRows.length === 0 && <p>No history yet.</p>}

      {/* Timeline cards */}
      {filteredRows.map((r) => {
        const color = ACTION_COLORS[r.action] || "#343a40";
        const diffEntries = r.changes ? Object.entries(r.changes) : [];

        return (
          <div key={r.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...badgeStyle, background: color }}>
                {r.action}
              </span>

              <div style={{ fontWeight: 700 }}>
                {new Date(r.changed_at).toLocaleString()}
              </div>

              {r.is_system && (
                <span style={{ fontSize: "0.8rem", color: "#666" }}>
                  (system)
                </span>
              )}
            </div>

            <div style={{ fontSize: "0.9rem", color: "#555", marginTop: 4 }}>
              Actor: <strong>{r.actor || "unknown"}</strong>
            </div>

            {/* Pretty diff */}
            {diffEntries.length > 0 ? (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  View changes ({diffEntries.length})
                </summary>

                <div style={{ marginTop: 8 }}>
                  {diffEntries.map(([field, values]) => (
                    <div key={field} style={diffRowStyle}>
                      <div style={{ fontWeight: 700, minWidth: 160 }}>
                        {field}
                      </div>
                      <div style={{ color: "#999" }}>
                        {stringifyVal(values?.old)}
                      </div>
                      <div style={{ padding: "0 8px", color: "#666" }}>→</div>
                      <div style={{ color: "#111" }}>
                        {stringifyVal(values?.new)}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div
                style={{ fontSize: "0.9rem", marginTop: 6, color: "#666" }}
              >
                No field-level diff recorded.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- helpers + styles ---------------- */

function stringifyVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (v === "") return '""';
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const cardStyle = {
  border: "1px solid #ddd",
  padding: "10px 12px",
  borderRadius: 8,
  marginBottom: 10,
  background: "white",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};

const badgeStyle = {
  color: "white",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: "0.78rem",
  fontWeight: 700,
  letterSpacing: 0.3,
};

const diffRowStyle = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "4px 0",
  borderBottom: "1px dashed #eee",
  fontSize: "0.9rem",
};

const btnGray = {
  padding: "0.35rem 0.8rem",
  borderRadius: "6px",
  border: "1px solid #ccc",
  backgroundColor: "#f8f9fa",
  cursor: "pointer",
};

const selectStyle = {
  marginLeft: 6,
  padding: "2px 6px",
  borderRadius: 4,
  border: "1px solid #ccc",
};
