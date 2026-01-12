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

// -------- Leading-zero helpers --------
function stripLeadingZeros(s) {
  const x = String(s ?? "");
  if (!/^\d+$/.test(x)) return x;          // only normalize purely numeric strings
  const y = x.replace(/^0+/, "");
  return y === "" ? "0" : y;
}

function keyVariants(keyValue) {
  const k = String(keyValue || "").trim();
  if (!k) return [];

  const stripped = stripLeadingZeros(k);

  // If no change, return just one key
  if (stripped === k) return [k];

  // Return both: try exact first, then fallback
  return [k, stripped];
}

function expandKeysWithVariants(keys) {
  const out = [];
  for (const k of keys || []) {
    out.push(...keyVariants(k));
  }
  // dedupe
  return Array.from(new Set(out.map((x) => String(x).trim()).filter(Boolean)));
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

  // Cache per *exact* scanned key; fallback result is still valid for this scan.
  const cached = getCached(mem.item, key);
  if (cached) return cached;

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Check Setup (Items sheet, tab, key column).");
  }

  const variants = keyVariants(key);
  let last = null;

  for (const v of variants) {
    const data = await callApi(
      "getItemByKey",
      {
        spreadsheetId: s.itemsSpreadsheetId,
        sheetName: s.itemsSheetName,
        keyColumn: s.keyColumn,
        keyValue: v,
      },
      { timeoutMs: 12000 }
    );

    // Attach which key actually matched in Sheets
    const enriched = { ...data, _keyUsed: v, _keyScanned: key };

    last = enriched;
    if (enriched?.found) {
      setCached(mem.item, key, enriched, 60_000);
      return enriched;
    }
  }

  // Not found for any variant
  setCached(mem.item, key, last, 30_000);
  return last;
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

  // Expand keys with variants so leading-zero scans still match numeric-stored sheet values.
  const cleanKeys = expandKeysWithVariants(keys);

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
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }

  const variants = keyVariants(key);
  let last = null;

  for (const v of variants) {
    const data = await callApi(
      "getItemAndHarvestByKey",
      {
        keyValue: v,
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

    const enriched = { ...data, _keyUsed: v, _keyScanned: key };

    last = enriched;
    if (enriched?.itemFound) {
      setCached(mem.combo, key, enriched,․․ 60_000);
      return enriched;
    }
  }

  setCached(mem.combo, key, last, 30_000);
  return last;
}

// ---------- Storage ----------
function requireStorageSettings() {
  const s = loadSettings();
  if (!s?.storageSpreadsheetId || !s?.bagStorageSheetName || !s?.binStorageSheetName) {
    throw new Error("Storage settings missing. Open Bin Storage tab and set Storage sheet + tabs first.");
  }
  return s;
}

export async function appendBagStorage({ bagLabel, vineIds }) {
  const s = requireStorageSettings();
  return await callApi("appendBagStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.bagStorageSheetName,
    bagLabel,
    vineIds,
  });
}

export async function appendBinStorage({ binLabel, bagLabels }) {
  const s = requireStorageSettings();
  return await callApi("appendBinStorage", {
    spreadsheetId: s.storageSpreadsheetId,
    sheetName: s.binStorageSheetName,
    binLabel,
    bagLabels,
  });
}

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
