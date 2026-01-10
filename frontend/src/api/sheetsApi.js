// src/api/sheetsApi.js
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

async function parseJsonOrExplain(resp) {
  const text = await resp.text().catch(() => "");

  // If HTML sneaks through, surface it cleanly
  if (/^\s*</.test(text)) {
    throw new Error(
      `Proxy/Apps Script returned HTML (not JSON). First 200 chars:\n${text.slice(0, 200)}`
    );
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Proxy returned non-JSON response (HTTP ${resp.status}).`);
  }
}

async function callApi(action, payload, { timeoutMs = 12_000 } = {}) {
  const s = loadSettings();
  if (!s?.proxyUrl) throw new Error("Missing Proxy URL. Go to Setup and save settings first.");

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(s.proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });

    const data = await parseJsonOrExplain(resp);

    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (HTTP ${resp.status})`);
    }

    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Request timed out. Check internet or Apps Script.");
    throw e;
  } finally {
    clearTimeout(to);
  }
}

// ---------- Generic ----------
export async function getHeaders(spreadsheetId, sheetName) {
  const r = await callApi("getHeaders", { spreadsheetId, sheetName });
  return r.headers || [];
}

export async function getSheetTabs(spreadsheetId) {
  const r = await callApi("getSheetTabs", { spreadsheetId });
  return r.tabs || [];
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

  const data = await callApi("getItemByKey", {
    spreadsheetId: s.itemsSpreadsheetId,
    sheetName: s.itemsSheetName,
    keyColumn: s.keyColumn,
    keyValue: key,
  });

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
    throw new Error("Harvest settings missing. Open Setup and set Harvest sheet + tab first.");
  }
  return s;
}

export async function appendHarvestLog(payload) {
  const s = requireHarvestSettings();
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
    throw new Error("Harvest settings missing. Open Setup and set Harvest sheet + tab first.");
  }

  const data = await callApi("getItemAndHarvestByKey", {
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
  });

  setCached(mem.combo, key, data, 60_000);
  return data;
}

// ---------- Storage ----------
function requireStorageSettings() {
  const s = loadSettings();
  if (!s?.storageSpreadsheetId || !s?.bagStorageSheetName || !s?.binStorageSheetName) {
    throw new Error("Storage settings missing. Open Bin Storage page and set Storage sheet + tabs first.");
  }
  return s;
}

/**
 * Bag -> Vine
 * Appends rows (timestamp, bag_label, vine_id)
 */
export async function appendBagStorage({ bagLabel, vineIds }) {
  const s = requireStorageSettings();
  return await callApi("appendBagStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.bagStorageSheetName,
    bagLabel,
    vineIds,
  });
}

/**
 * Bin -> Bag IN
 * Appends rows (timestamp, bin_label, bag_label)
 */
export async function appendBinStorage({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  return await callApi("appendBinStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    binLabel,
    bagLabels,
  });
}

/**
 * mode="bag": returns existing vine_id for bag_label
 * mode="bin": returns existing bag_label for bin_label
 */
export async function getExistingChildrenForParent({ mode, parentLabel }) {
  const s = requireStorageSettings();
  const sheetName = mode === "bag" ? s.bagStorageSheetName : s.binStorageSheetName;

  const r = await callApi("getExistingChildrenForParent", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName,
    mode,
    parentLabel,
  });

  return r.children || [];
}

/**
 * NEW: Find which bin contains this bag label.
 * Uses storage bin scan tab.
 */
export async function findBinForBagLabel({ bagLabel }) {
  const s = requireStorageSettings();
  const r = await callApi("findBinForBagLabel", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    bagLabel,
  });
  return { found: !!r.found, binLabel: r.binLabel || "" };
}

/**
 * NEW: Remove rows for OUT operation (bin_label + bag_labels).
 */
export async function removeBinStorageByBagLabels({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  const r = await callApi("removeBinStorageByBagLabels", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    binLabel,
    bagLabels,
  });
  return { removed: Number(r.removed || 0), notFound: Array.isArray(r.notFound) ? r.notFound : [] };
}
