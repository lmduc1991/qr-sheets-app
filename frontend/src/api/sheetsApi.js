// frontend/src/api/sheetsApi.js
import { loadSettings } from "../store/settingsStore";

const mem = {
  item: new Map(), // key -> { data, exp }
  combo: new Map(), // key -> { data, exp }
};

function nowMs() {
  return Date.now();
}

function getCached(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.exp <= nowMs()) {
    map.delete(key);
    return null;
  }
  return v.data;
}

function setCached(map, key, data, ttlMs = 60_000) {
  map.set(key, { data, exp: nowMs() + ttlMs });
}

function invalidateKey(key) {
  mem.item.delete(key);
  mem.combo.delete(key);
}

async function callApi(action, payload, { timeoutMs = 12000 } = {}) {
  const s = loadSettings();
  if (!s?.proxyUrl) throw new Error("Missing Proxy URL. Go to Setup and save settings first.");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(s.proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (${resp.status})`);
    }
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Request timed out. Check internet or Apps Script.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function getHeaders(spreadsheetId, sheetName) {
  const r = await callApi("getHeaders", { spreadsheetId, sheetName });
  return r.headers || [];
}

// ---------- Items ----------
export async function getItemByKey(keyValue) {
  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key value.");

  const cached = getCached(mem.item, key);
  if (cached) return cached;

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Check Setup (Items sheet, tab, key column).");
  }

  const data = await callApi(
    "getItemByKey",
    {
      spreadsheetId: s.itemsSpreadsheetId,
      sheetName: s.itemsSheetName,
      keyColumn: s.keyColumn,
      keyValue: key,
    },
    { timeoutMs: 12000 }
  );

  setCached(mem.item, key, data, 60_000);
  return data;
}

export async function updateItemByKey(keyValue, patch) {
  const key = String(keyValue || "").trim();
  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Check Setup (Items sheet, tab, key column).");
  }

  const r = await callApi("updateItemByKey", {
    spreadsheetId: s.itemsSpreadsheetId,
    sheetName: s.itemsSheetName,
    keyColumn: s.keyColumn,
    keyValue: key,
    patch,
  });

  invalidateKey(key);
  return r;
}

export async function bulkUpdate(keys, patch) {
  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Check Setup (Items sheet, tab, key column).");
  }

  const cleanKeys = (keys || []).map((k) => String(k || "").trim()).filter(Boolean);

  const r = await callApi("bulkUpdate", {
    spreadsheetId: s.itemsSpreadsheetId,
    sheetName: s.itemsSheetName,
    keyColumn: s.keyColumn,
    keys: cleanKeys,
    patch,
  });

  cleanKeys.forEach(invalidateKey);
  return r;
}

// ---------- Harvest ----------
function requireHarvestSettings() {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }
  return s;
}

export async function appendHarvestLog(payload) {
  const s = requireHarvestSettings();

  // After append, combined cache for that key is stale
  if (payload?.itemKey) invalidateKey(String(payload.itemKey).trim());

  return await callApi("appendHarvestLog", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    ...payload,
  });
}

export async function getHarvestLogByKey(itemKey) {
  const s = requireHarvestSettings();

  return await callApi("getHarvestLogByKey", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    itemKey,
  });
}

export async function updateHarvestLogByRow(payload) {
  const s = requireHarvestSettings();

  if (payload?.itemKey) invalidateKey(String(payload.itemKey).trim());

  return await callApi("updateHarvestLogByRow", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    ...payload,
  });
}

/**
 * One call gets item + harvest log (latest) for the same key.
 * Used by Harvest scan.
 */
export async function getItemAndHarvestByKey(keyValue) {
  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key value.");

  const cached = getCached(mem.combo, key);
  if (cached) return cached;

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Check Setup (Items sheet, tab, key column).");
  }
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }

  const data = await callApi(
    "getItemAndHarvestByKey",
    {
      keyValue: key,
      items: {
        spreadsheetId: s.itemsSpreadsheetId,
        sheetName: s.itemsSheetName,
        keyColumn: s.keyColumn,
      },
      harvest: {
        spreadsheetId: s.harvestSpreadsheetId,
        sheetName: s.harvestSheetName,
      },
    },
    { timeoutMs: 12000 }
  );

  setCached(mem.combo, key, data, 60_000);
  return data;
}
