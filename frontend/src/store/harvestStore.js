const KEY = "qr_harvest_photos_v1";

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function saveAll(obj) {
  localStorage.setItem(KEY, JSON.stringify(obj));
}

export function getPhotos(itemKey) {
  const all = loadAll();
  return all[itemKey] || [];
}

export function addPhoto(itemKey, dataUrl) {
  const all = loadAll();
  const list = all[itemKey] || [];
  list.push({
    dataUrl,
    ts: Date.now(),
  });
  all[itemKey] = list;
  saveAll(all);
}

export function removePhoto(itemKey, index) {
  const all = loadAll();
  const list = all[itemKey] || [];
  if (index < 0 || index >= list.length) return;
  list.splice(index, 1);
  all[itemKey] = list;
  saveAll(all);
}

export function clearPhotos(itemKey) {
  const all = loadAll();
  delete all[itemKey];
  saveAll(all);
}

export function clearAllPhotos() {
  saveAll({});
}

export function getPhotoCount(itemKey) {
  return getPhotos(itemKey).length;
}

// Used by ZIP export
export function getAllPhotos() {
  return loadAll();
}
