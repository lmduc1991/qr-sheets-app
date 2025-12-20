import { useMemo, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Capacitor } from "@capacitor/core";
import { ScopedStorage } from "@daniele-rolli/capacitor-scoped-storage";
import { clearAllPhotos } from "../store/harvestStore";
import { loadSettings, saveSettings } from "../store/settingsStore";

const PHOTOS_KEY = "qr_harvest_photos_v1";
const EXPORT_FOLDER_KEY = "exportFolder"; // stored inside settings

function safeParse(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function splitDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const [header, base64] = s.split(",");
  if (!base64) return null;
  const m = header.match(/data:(.*);base64/);
  const mime = m ? m[1] : "image/jpeg";
  return { mime, base64 };
}

function getSavedFolder() {
  const s = loadSettings() || {};
  return s[EXPORT_FOLDER_KEY] || null; // { id, name }
}

function setSavedFolder(folder) {
  saveSettings({ [EXPORT_FOLDER_KEY]: folder });
}

// bytes -> base64 (safe for large files)
function uint8ToBase64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ExportHarvestZipButton() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savedUri, setSavedUri] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [folder, setFolder] = useState(() => getSavedFolder());

  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);

  const chooseFolder = async () => {
    setStatus("");
    setError("");
    setSavedUri("");

    try {
      const res = await ScopedStorage.pickFolder();
      if (!res?.folder?.id) throw new Error("No folder selected.");
      setSavedFolder(res.folder);
      setFolder(res.folder);
      setStatus(`Export folder set to: ${res.folder.name || "Selected folder"}`);
    } catch (e) {
      setError(e?.message || "Failed to choose folder.");
    }
  };

  const exportZip = async () => {
    setStatus("");
    setError("");
    setSavedUri("");
    setIsBusy(true);

    try {
      const data = safeParse(localStorage.getItem(PHOTOS_KEY));
      const itemKeys = Object.keys(data || {});
      if (itemKeys.length === 0) throw new Error("No harvest photos found on this device.");

      let totalPhotos = 0;
      for (const k of itemKeys) totalPhotos += (data[k] || []).length;
      if (totalPhotos === 0) throw new Error("No harvest photos found on this device.");

      const zip = new JSZip();

      for (const itemKey of itemKeys) {
        const photos = data[itemKey] || [];
        for (let i = 0; i < photos.length; i++) {
          const parsed = splitDataUrl(photos[i]?.dataUrl);
          if (!parsed) continue;

          const ext =
            parsed.mime === "image/png" ? "png" :
            parsed.mime === "image/webp" ? "webp" :
            "jpg";

          zip.file(
            `${itemKey}/photo_${String(i + 1).padStart(3, "0")}.${ext}`,
            parsed.base64,
            { base64: true }
          );
        }
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      let filename = `harvest_photos_${ts}.zip`;
      if (!filename.toLowerCase().endsWith(".zip")) filename += ".zip";

      // Web fallback
      if (!isNative) {
        setStatus("Exporting ZIP…");
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, filename);
        setStatus("Exported ZIP successfully.");
        return;
      }

      if (!folder?.id) {
        setError("No export folder selected. Tap “Choose Export Folder” first and pick Downloads.");
        return;
      }

      setStatus("Creating ZIP…");

      // Generate ZIP as bytes then base64 it ourselves (more reliable)
      const zipBytes = await zip.generateAsync({ type: "uint8array" });
      const base64Zip = uint8ToBase64(zipBytes);

      const exportDir = "HarvestExports";
      try {
        await ScopedStorage.mkdir({ folder, path: exportDir, recursive: true });
      } catch {
        // ignore
      }

      const relPath = `${exportDir}/${filename}`;

      setStatus("Saving ZIP to selected folder…");

      // Try to pass MIME type if supported by plugin/version.
      // If the plugin ignores unknown fields, this is safe.
      await ScopedStorage.writeFile({
        folder,
        path: relPath,
        data: base64Zip,
        encoding: "base64",
        mimeType: "application/zip",
      });

      const uriRes = await ScopedStorage.getUriForPath({ folder, path: relPath });
      setSavedUri(uriRes?.uri || "");
      setStatus("Export completed. ZIP saved to your selected folder (USB-visible).");

      const ok = window.confirm("Exported. Do you want to delete all stored photos from this device?");
      if (ok) clearAllPhotos();
    } catch (e) {
      setStatus("");
      setError(e?.message || "Export failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {isNative && (
        <button onClick={chooseFolder} disabled={isBusy}>
          Choose Export Folder (pick Downloads for USB)
        </button>
      )}

      {isNative && folder?.id && (
        <div className="alert" style={{ wordBreak: "break-word" }}>
          <strong>Export folder:</strong> {folder?.name || "Selected folder"}
        </div>
      )}

      <button onClick={exportZip} disabled={isBusy}>
        {isBusy ? "Exporting…" : "Export Harvest Photos (ZIP)"}
      </button>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {savedUri && (
        <div className="alert" style={{ wordBreak: "break-word" }}>
          <strong>Saved URI:</strong> {savedUri}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
            USB copy: connect phone → open the folder you selected (Downloads/Documents) → HarvestExports → copy the ZIP.
          </div>
        </div>
      )}
    </div>
  );
}
