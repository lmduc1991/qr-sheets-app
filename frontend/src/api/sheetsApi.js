// src/api/sheetsApi.js
import { loadSettings } from "../store/settingsStore";

/**
 * Notes:
 * - All requests go through the Cloudflare proxy (POST JSON).
 * - The proxy forwards to Apps Script web app which expects:
 *   { action: string, payload: object }
 *
 * Storage actions used by BinStoragePage:
 * - getSheetTabs
 * - appendBagStorage
 * - appendBinStorage
 * - getExistingChildrenForParent
 * - findBinForBagLabel
 * - removeBinStorageByBagLabels
 */

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

function setCached(map, key, data, ttlMs) {
  map.set(key, { data, exp: nowMs() + ttlMs });
}

async function parseJsonOrExplain(resp) {
  const txt = await resp.text();
  try {
    return txt ? JSON.parse(txt) : {};
  } catch {
    // Provide a better error than "Unexpected token <"
    throw new Error(
      `Server returned non-JSON response (HTTP ${resp.status}). First 200 chars:\n${txt.slice(0, 200)}`
    );
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
    if (e?.name === "AbortError") throw new Error("Request timeout. Please try again.");
    throw e;
  } finally {
    clearTimeout(to);
  }
}

// -------------------- Items / Harvest (existing exports retained) --------------------

export async function getHeaders({ spreadsheetId, sheetName }) {
  return await callApi("getHeaders", { spreadsheetId, sheetName });
}

export async function getItemByKey({ spreadsheetId, sheetName, keyColumn, keyValue }) {
  const cacheKey = `${spreadsheetId}::${sheetName}::${keyColumn}::${keyValue}`;
  const cached = getCached(mem.item, cacheKey);
  if (cached) return cached;

  const r = await callApi("getItemByKey", { spreadsheetId, sheetName, keyColumn, keyValue });
  setCached(mem.item, cacheKey, r, 10_000);
  return r;
}

export async function updateItemByKey(payload) {
  // payload includes spreadsheetId, sheetName, keyColumn, keyValue, updates
  return await callApi("updateItemByKey", payload);
}

export async function bulkUpdate(payload) {
  return await callApi("bulkUpdate", payload);
}

export async function appendHarvestLog(payload) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Missing Harvest settings. Go to Setup and set Harvest sheet first.");
  }

  return await callApi("appendHarvestLog", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    ...payload,
  });
}

export async function getHarvestLogByKey(payload) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Missing Harvest settings. Go to Setup and set Harvest sheet first.");
  }

  return await callApi("getHarvestLogByKey", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    ...payload,
  });
}

export async function updateHarvestLogByRow(payload) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Missing Harvest settings. Go to Setup and set Harvest sheet first.");
  }

  return await callApi("updateHarvestLogByRow", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    ...payload,
  });
}

export async function getItemAndHarvestByKey(payload) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Missing Harvest settings. Go to Setup and set Harvest sheet first.");
  }

  // small cache
  const cacheKey = JSON.stringify({ ...payload, hs: s.harvestSpreadsheetId, hn: s.harvestSheetName });
  const cached = getCached(mem.combo, cacheKey);
  if (cached) return cached;

  const r = await callApi("getItemAndHarvestByKey", {
    spreadsheetId: payload.spreadsheetId,
    sheetName: payload.sheetName,
    keyColumn: payload.keyColumn,
    keyValue: payload.keyValue,
    harvestSpreadsheetId: s.harvestSpreadsheetId,
    harvestSheetName: s.harvestSheetName,
  });

  setCached(mem.combo, cacheKey, r, 8_000);
  return r;
}

// -------------------- Storage (Bin Storage) --------------------

function requireStorageSettings() {
  const s = loadSettings();
  if (!s?.storageSpreadsheetId || !s?.bagStorageSheetName || !s?.binStorageSheetName) {
    throw new Error("Storage settings missing. Open Bin Storage Settings and complete setup first.");
  }
  return s;
}

export async function getSheetTabs({ spreadsheetId }) {
  return await callApi("getSheetTabs", { spreadsheetId });
}

/**
 * Bag -> Vine
 * Writes to the "bag scan" tab (timestamp, bag_label, vine_id)
 */
export async function appendBagStorage({ bagLabel, vineIds }) {
  const s = requireStorageSettings();
  // send both camelCase and snake_case to be tolerant of Apps Script implementations
  return await callApi("appendBagStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.bagStorageSheetName,
    bagLabel,
    vineIds,
    bag_label: bagLabel,
    vine_ids: vineIds,
  });
}

/**
 * Bin -> Bag (In)
 * Writes to the "bin scan" tab (timestamp, bin_label, bag_label)
 */
export async function appendBinStorage({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  return await callApi("appendBinStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    binLabel,
    bagLabels,
    bin_label: binLabel,
    bag_labels: bagLabels,
  });
}

/**
 * Read existing children for a parent label.
 * - mode="bag": parentLabel = bag label => children = vine ids already linked
 * - mode="bin": parentLabel = bin label => children = bag labels already linked
 */
export async function getExistingChildrenForParent({ mode, parentLabel }) {
  const s = requireStorageSettings();
  const sheetName = mode === "bag" ? s.bagStorageSheetName : s.binStorageSheetName;

  const r = await callApi("getExistingChildrenForParent", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName,
    mode,
    parentLabel,
    parent_label: parentLabel,
  });

  return r.children || [];
}

/**
 * Find which BIN currently contains a given BAG label.
 * Expected Apps Script return: { ok:true, found:true/false, binLabel?: string }
 */
export async function findBinForBagLabel({ bagLabel }) {
  const s = requireStorageSettings();
  const r = await callApi("findBinForBagLabel", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    bagLabel,
    bag_label: bagLabel,
  });

  return {
    found: !!r.found,
    binLabel: r.binLabel || r.bin_label || "",
  };
}

/**
 * Remove bin->bag rows by bag labels (typically for OUT).
 * Expected Apps Script return: { ok:true, removed:number, notFound:string[] }
 */
export async function removeBinStorageByBagLabels({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  const r = await callApi("removeBinStorageByBagLabels", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    binLabel,
    bagLabels,
    bin_label: binLabel,
    bag_labels: bagLabels,
  });

  return {
    removed: Number(r.removed || 0),
    notFound: Array.isArray(r.notFound) ? r.notFound : [],
  };
}
