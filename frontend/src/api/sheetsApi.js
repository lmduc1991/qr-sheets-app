// frontend/src/api/sheetsApi.js
import { loadSettings } from "../store/settingsStore";

const mem = {
  item: new Map(), // key -> { data, exp }
  combo: new Map(), // key -> { data, exp }
  packing: new Map(), // key -> { data, exp } (packing label lookups)
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

function invalidatePackingKey(key) {
  mem.packing.delete(key);
}

// -------- Leading-zero helpers --------
function stripLeadingZeros(s) {
  const x = String(s ?? "");
  if (!/^\d+$/.test(x)) return x; // only normalize purely numeric strings
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

// ---------- Network core ----------
async function callApi(action, payload, { timeoutMs = 12000 } = {}) {
  const s = loadSettings();
  if (!s?.proxyUrl) throw new Error("Missing Proxy URL. Go to Setup and set Cloudflare Worker URL first.");

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(s.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: ctrl.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text || "Invalid JSON from server");
    }

    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    if (data?.ok === false) throw new Error(data?.error || "Request failed");
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Request timeout. Please retry.");
    throw e;
  } finally {
    clearTimeout(to);
  }
}

// ---------- Items ----------
export async function getHeaders(spreadsheetId, sheetName) {
  return await callApi("getHeaders", { spreadsheetId, sheetName });
}

export async function getItemByKey(keyValue, { timeoutMs = 12000 } = {}) {
  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key.");

  const cached = getCached(mem.item, key);
  if (cached) return cached;

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Go to Setup and set Items sheet + Key Column first.");
  }

  // Try variants to preserve leading zeros behavior
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
      { timeoutMs }
    );

    last = { ...data, _keyUsed: v, _keyScanned: key };
    if (last?.found) {
      setCached(mem.item, key, last, 60_000);
      return last;
    }
  }

  setCached(mem.item, key, last, 30_000);
  return last;
}

export async function updateItemByKey(keyValue, patch) {
  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key.");

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Go to Setup and set Items sheet + Key Column first.");
  }

  const r = await callApi("updateItemByKey", {
    spreadsheetId: s.itemsSpreadsheetId,
    sheetName: s.itemsSheetName,
    keyColumn: s.keyColumn,
    keyValue: key,
    patch: patch || {},
  });

  invalidateKey(key);
  return r;
}

export async function bulkUpdate(keys, patch) {
  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Go to Setup and set Items sheet + Key Column first.");
  }

  const expandedKeys = expandKeysWithVariants(keys);

  const r = await callApi("bulkUpdate", {
    spreadsheetId: s.itemsSpreadsheetId,
    sheetName: s.itemsSheetName,
    keyColumn: s.keyColumn,
    keys: expandedKeys,
    patch: patch || {},
  });

  // invalidate scanned keys cache
  for (const k of expandedKeys) invalidateKey(k);

  return r;
}

// ---------- Harvest (unchanged) ----------
export async function appendHarvestLog(payload) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }

  return await callApi("appendHarvestLog", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    row: payload,
  });
}

export async function getHarvestLogByKey(keyValue) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }

  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key.");

  return await callApi("getHarvestLogByKey", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    keyValue: key,
  });
}

export async function updateHarvestLogByRow(rowIndex, patch) {
  const s = loadSettings();
  if (!s?.harvestSpreadsheetId || !s?.harvestSheetName) {
    throw new Error("Harvest settings missing. Open Harvest tab and set Harvest sheet + tab first.");
  }

  return await callApi("updateHarvestLogByRow", {
    spreadsheetId: s.harvestSpreadsheetId,
    sheetName: s.harvestSheetName,
    rowIndex,
    patch: patch || {},
  });
}

export async function getItemAndHarvestByKey(keyValue) {
  const key = String(keyValue || "").trim();
  if (!key) throw new Error("Missing key.");

  const cached = getCached(mem.combo, key);
  if (cached) return cached;

  const s = loadSettings();
  if (!s?.itemsSpreadsheetId || !s?.itemsSheetName || !s?.keyColumn) {
    throw new Error("Items settings missing. Go to Setup and set Items sheet + Key Column first.");
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
      // FIX: remove invalid characters that could break builds
      setCached(mem.combo, key, enriched, 60_000);
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

export async function getSheetTabs(spreadsheetId) {
  return await callApi("getSheetTabs", { spreadsheetId });
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

// ---------- Packing / Unpacking ----------
function requirePackingSettings(needs) {
  const s = loadSettings();
  if (!s?.packingSpreadsheetId) {
    throw new Error("Packing settings missing. Open Packing tab and save the Packing Sheet setup first.");
  }
  if (needs === "or" && !s?.packingOrSheetName) {
    throw new Error("Packing OR tab is not set. Open Packing tab and choose OR tab, then Save Packing Setup.");
  }
  if (needs === "grafting" && !s?.packingGraftingSheetName) {
    throw new Error("Packing GRAFTING tab is not set. Open Packing tab and choose GRAFTING tab, then Save Packing Setup.");
  }
  return s;
}

function getPackingSheetName(s, needs) {
  return needs === "grafting" ? s.packingGraftingSheetName : s.packingOrSheetName;
}

/**
 * Lookup a packing record by a scanned label QR.
 * Expected backend response:
 * { found: boolean, rowIndex?: number, record?: object, headers?: string[] }
 */
export async function getPackingRecordByLabel({ needs = "or", labelValue, timeoutMs = 12000 } = {}) {
  const label = String(labelValue || "").trim();
  if (!label) throw new Error("Missing label value.");

  const cached = getCached(mem.packing, label);
  if (cached) return cached;

  const s = requirePackingSettings(needs);
  const sheetName = getPackingSheetName(s, needs);

  const r = await callApi(
    "getPackingRecordByLabel",
    {
      spreadsheetId: s.packingSpreadsheetId,
      sheetName,
      needs,
      labelValue: label,
    },
    { timeoutMs }
  );

  // Cache even negative lookups briefly (prevents hammering)
  setCached(mem.packing, label, r, r?.found ? 60_000 : 20_000);
  return r;
}

/**
 * Update packing fields by row index (note is append-only on backend).
 * Expected backend response:
 * { updated: number }
 */
export async function updatePackingByRow({
  needs = "or",
  rowIndex,
  label1,
  label2,
  packingDate,
  packingQuantity,
  noteAppend,
  timeoutMs = 12000,
} = {}) {
  const s = requirePackingSettings(needs);
  const sheetName = getPackingSheetName(s, needs);

  const r = await callApi(
    "updatePackingByRow",
    {
      spreadsheetId: s.packingSpreadsheetId,
      sheetName,
      needs,
      rowIndex,
      label1,
      label2,
      packingDate,
      packingQuantity,
      noteAppend,
    },
    { timeoutMs }
  );

  // Invalidate caches for scanned labels (so re-scan shows fresh values)
  if (label1) invalidatePackingKey(String(label1).trim());
  if (label2) invalidatePackingKey(String(label2).trim());

  return r;
}
