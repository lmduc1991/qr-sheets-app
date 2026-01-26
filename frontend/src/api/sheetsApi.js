// src/api/sheetsApi.js
import { loadSettings, saveSettings } from "../store/settingsStore";

const mem = {
  tabs: new Map(),
  items: new Map(),
  harvest: new Map(),
  packing: new Map(),
};

function now() {
  return Date.now();
}

function getCached(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.expiresAt && v.expiresAt < now()) {
    map.delete(key);
    return null;
  }
  return v.data;
}

function setCached(map, key, data, ttlMs) {
  map.set(key, { data, expiresAt: ttlMs ? now() + ttlMs : 0 });
}

// ---------- Settings normalization (critical compatibility layer) ----------
function normalizeSettings() {
  const s = loadSettings() || {};

  // Accept older key names and keep them in sync
  const itemsKeyColumn = String(s.itemsKeyColumn || s.keyColumn || "").trim();
  const itemsSpreadsheetId = String(s.itemsSpreadsheetId || "").trim();
  const itemsSheetName = String(s.itemsSheetName || "").trim();

  // Mirror forward if only old key exists
  if (itemsKeyColumn && !s.itemsKeyColumn) {
    try {
      saveSettings({ itemsKeyColumn });
    } catch {
      // ignore
    }
  }

  return {
    ...s,
    itemsSpreadsheetId,
    itemsSheetName,
    itemsKeyColumn,
  };
}

function requireSettings() {
  const s = normalizeSettings();
  if (!s?.proxyUrl) throw new Error("Proxy URL is not set. Please set it in Setup.");
  if (!s?.itemsSpreadsheetId) throw new Error("Items spreadsheet is not set. Please set it in Setup.");
  if (!s?.itemsSheetName) throw new Error("Items tab is not set. Please set it in Setup.");
  if (!s?.itemsKeyColumn) throw new Error("Items key column is not set. Please set it in Setup.");
  return s;
}

async function callApi(action, payload, opts = {}) {
  const s = normalizeSettings();
  const proxyUrl = s?.proxyUrl;
  if (!proxyUrl) throw new Error("Proxy URL is not set. Please set it in Setup.");

  const timeoutMs = opts.timeoutMs ?? 15000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ action, payload }),
    });

    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "Unknown API error");
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Argument adapters (backward compatible) ----------
function asObjHeaders(a, b) {
  // Supports: getHeaders({spreadsheetId, sheetName}) OR getHeaders(spreadsheetId, sheetName)
  if (a && typeof a === "object") return a;
  return { spreadsheetId: a, sheetName: b };
}

function asObjKey(a) {
  // Supports: fn({keyValue}) OR fn(keyValue)
  if (a && typeof a === "object") return a;
  return { keyValue: a };
}

function asObjUpdateItem(a, b) {
  // Supports: updateItemByKey({keyValue, patch}) OR updateItemByKey(keyValue, patch)
  if (a && typeof a === "object") return a;
  return { keyValue: a, patch: b };
}

function asObjBulk(a, b) {
  // Supports: bulkUpdate({keys, patch}) OR bulkUpdate(keys, patch)
  if (a && typeof a === "object") return a;
  return { keys: a, patch: b };
}

// ---------- Tabs ----------
export async function getSheetTabs(spreadsheetId) {
  const id = String(spreadsheetId || "").trim();
  if (!id) throw new Error("Missing spreadsheetId");

  const cached = getCached(mem.tabs, id);
  if (cached) return cached;

  const r = await callApi("getSheetTabs", { spreadsheetId: id }, { timeoutMs: 12000 });
  const tabs = r.tabs || [];
  setCached(mem.tabs, id, tabs, 60_000);
  return tabs;
}

// ---------- Items ----------
export async function getHeaders(a, b) {
  const { spreadsheetId, sheetName } = asObjHeaders(a, b);

  if (!String(spreadsheetId || "").trim()) throw new Error("Missing or invalid spreadsheet.id");
  if (!String(sheetName || "").trim()) throw new Error("Missing sheetName");

  const r = await callApi("getHeaders", { spreadsheetId, sheetName }, { timeoutMs: 12000 });
  return r.headers || [];
}

export async function getItemByKey(a) {
  const s = requireSettings();
  const { keyValue } = asObjKey(a);

  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key value");

  const cacheKey = `item::${key}`;
  const cached = getCached(mem.items, cacheKey);
  if (cached) return cached;

  const r = await callApi(
    "getItemByKey",
    {
      spreadsheetId: s.itemsSpreadsheetId,
      sheetName: s.itemsSheetName,
      keyColumn: s.itemsKeyColumn,
      keyValue: key,
    },
    { timeoutMs: 12000 }
  );

  setCached(mem.items, cacheKey, r, 10_000);
  return r;
}

export async function updateItemByKey(a, b) {
  const s = requireSettings();
  const { keyValue, patch } = asObjUpdateItem(a, b);

  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key value");

  const r = await callApi(
    "updateItemByKey",
    {
      spreadsheetId: s.itemsSpreadsheetId,
      sheetName: s.itemsSheetName,
      keyColumn: s.itemsKeyColumn,
      keyValue: key,
      patch: patch || {},
    },
    { timeoutMs: 15000 }
  );
  return r;
}

export async function bulkUpdate(a, b) {
  const s = requireSettings();
  const { keys, patch } = asObjBulk(a, b);

  const r = await callApi(
    "bulkUpdate",
    {
      spreadsheetId: s.itemsSpreadsheetId,
      sheetName: s.itemsSheetName,
      keyColumn: s.itemsKeyColumn,
      keys,
      patch,
    },
    { timeoutMs: 30000 }
  );
  return r;
}

// ---------- Harvest ----------
function requireHarvestSettings() {
  const s = normalizeSettings();
  if (!s?.harvestSpreadsheetId) throw new Error("Harvest spreadsheet is not set. Please set it in Harvest page.");
  if (!s?.harvestSheetName) throw new Error("Harvest tab is not set. Please set it in Harvest page.");
  return s;
}

export async function getItemAndHarvestByKey(a) {
  const s = requireSettings();
  const h = requireHarvestSettings();
  const { keyValue } = asObjKey(a);

  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key value");

  const cacheKey = `itemHarvest::${key}`;
  const cached = getCached(mem.harvest, cacheKey);
  if (cached) return cached;

  const r = await callApi(
    "getItemAndHarvestByKey",
    {
      keyValue: key,
      items: { spreadsheetId: s.itemsSpreadsheetId, sheetName: s.itemsSheetName, keyColumn: s.itemsKeyColumn },
      harvest: { spreadsheetId: h.harvestSpreadsheetId, sheetName: h.harvestSheetName },
    },
    { timeoutMs: 15000 }
  );

  setCached(mem.harvest, cacheKey, r, 8_000);
  return r;
}

export async function appendHarvestLog(payload) {
  const h = requireHarvestSettings();
  const r = await callApi(
    "appendHarvestLog",
    { spreadsheetId: h.harvestSpreadsheetId, sheetName: h.harvestSheetName, ...(payload || {}) },
    { timeoutMs: 15000 }
  );
  return r;
}

export async function getHarvestLogByKey(itemKey) {
  const h = requireHarvestSettings();
  const key = String(itemKey || "").trim();
  if (!key) throw new Error("Missing itemKey");

  const r = await callApi(
    "getHarvestLogByKey",
    { spreadsheetId: h.harvestSpreadsheetId, sheetName: h.harvestSheetName, itemKey: key },
    { timeoutMs: 12000 }
  );
  return r;
}

export async function updateHarvestLogByRow(payload) {
  const h = requireHarvestSettings();
  const r = await callApi(
    "updateHarvestLogByRow",
    { spreadsheetId: h.harvestSpreadsheetId, sheetName: h.harvestSheetName, ...(payload || {}) },
    { timeoutMs: 15000 }
  );
  return r;
}

// ---------- Storage ----------
function requireStorageSettings() {
  const s = normalizeSettings();
  if (!s?.storageSpreadsheetId) throw new Error("Storage spreadsheet is not set. Please set it in Storage pages.");
  if (!s?.bagStorageSheetName) throw new Error("Bag storage tab is not set.");
  if (!s?.binStorageSheetName) throw new Error("Bin storage tab is not set.");
  return s;
}

export async function appendBagStorage({ bagLabel, vineIds }) {
  const s = requireStorageSettings();
  const r = await callApi(
    "appendBagStorage",
    { spreadsheetId: s.storageSpreadsheetId, sheetName: s.bagStorageSheetName, bagLabel, vineIds },
    { timeoutMs: 15000 }
  );
  return r;
}

export async function appendBinStorage({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  const r = await callApi(
    "appendBinStorage",
    { spreadsheetId: s.storageSpreadsheetId, sheetName: s.binStorageSheetName, binLabel, bagLabels },
    { timeoutMs: 15000 }
  );
  return r;
}

export async function getExistingChildrenForParent({ mode, parentLabel }) {
  const s = requireStorageSettings();
  const sheetName = mode === "bag" ? s.bagStorageSheetName : s.binStorageSheetName;

  const r = await callApi(
    "getExistingChildrenForParent",
    { spreadsheetId: s.storageSpreadsheetId, sheetName, mode, parentLabel },
    { timeoutMs: 12000 }
  );
  return r.children || [];
}

export async function findBinForBagLabel({ bagLabel }) {
  const s = requireStorageSettings();
  const r = await callApi(
    "findBinForBagLabel",
    { spreadsheetId: s.storageSpreadsheetId, sheetName: s.binStorageSheetName, bagLabel },
    { timeoutMs: 12000 }
  );
  return r;
}

export async function removeBinStorageByBagLabels({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  const r = await callApi(
    "removeBinStorageByBagLabels",
    { spreadsheetId: s.storageSpreadsheetId, sheetName: s.binStorageSheetName, binLabel, bagLabels },
    { timeoutMs: 20000 }
  );
  return r;
}

// ---------- Packing / Unpacking ----------
function requirePackingSettings(needs = "or") {
  const s = normalizeSettings();

  const spreadsheetId = String(
    s.packingSpreadsheetId || s.packingUnpackingSpreadsheetId || s.packingUnpackingId || s.packingSpreadsheetID || ""
  ).trim();

  if (!spreadsheetId) throw new Error("Packing settings missing. Paste the Packing/Unpacking spreadsheet link first.");

  const sheetName =
    needs === "grafting"
      ? String(s.packingGraftingSheetName || s.grafting_tab_label || s.graftingTabLabel || "").trim()
      : String(s.packingOrSheetName || s.or_tab_label || s.orTabLabel || "").trim();

  if (!sheetName) throw new Error(needs === "grafting" ? "Grafting tab is not set." : "OR tab is not set.");

  return { ...s, packingSpreadsheetId: spreadsheetId, _packingSheetName: sheetName };
}

export async function getPackingRecordByLabel({ needs = "or", labelValue }) {
  const s = requirePackingSettings(needs);
  const key = `${needs}::${String(labelValue || "").trim()}`;
  const cached = getCached(mem.packing, key);
  if (cached) return cached;

  const r = await callApi(
    "getPackingRecordByLabel",
    { spreadsheetId: s.packingSpreadsheetId, sheetName: s._packingSheetName, needs, labelValue },
    { timeoutMs: 12000 }
  );

  setCached(mem.packing, key, r, 30_000);
  return r;
}

export async function updatePackingByRow({ needs = "or", rowIndex, packingDate, binNumber, packingQuantity, noteAppend }) {
  const s = requirePackingSettings(needs);
  const r = await callApi(
    "updatePackingByRow",
    { spreadsheetId: s.packingSpreadsheetId, sheetName: s._packingSheetName, needs, rowIndex, packingDate, binNumber, packingQuantity, noteAppend },
    { timeoutMs: 15000 }
  );
  return r;
}

export async function getUnpackingRecordByLabel({ needs = "or", labelValue }) {
  const s = requirePackingSettings(needs);
  const key = `unpack::${needs}::${String(labelValue || "").trim()}`;
  const cached = getCached(mem.packing, key);
  if (cached) return cached;

  const r = await callApi(
    "getUnpackingRecordByLabel",
    { spreadsheetId: s.packingSpreadsheetId, sheetName: s._packingSheetName, needs, labelValue },
    { timeoutMs: 12000 }
  );

  setCached(mem.packing, key, r, 30_000);
  return r;
}

export async function updateUnpackingByRow({ needs = "or", rowIndex, unpackingDate, unpackingQuantity, noteAppend }) {
  const s = requirePackingSettings(needs);
  const r = await callApi(
    "updateUnpackingByRow",
    { spreadsheetId: s.packingSpreadsheetId, sheetName: s._packingSheetName, needs, rowIndex, unpackingDate, unpackingQuantity, noteAppend },
    { timeoutMs: 15000 }
  );
  return r;
}
