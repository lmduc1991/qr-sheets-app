import { useMemo, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Capacitor } from "@capacitor/core";
import { ScopedStorage } from "@daniele-rolli/capacitor-scoped-storage";
import { clearAllPhotos } from "../store/harvestStore";
import { loadSettings, saveSettings } from "../store/settingsStore";
import { useT } from "../i18n";

const PHOTOS_KEY = "qr_harvest_photos_v1";
const EXPORT_FOLDER_KEY = "exportFolder";

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
  return s[EXPORT_FOLDER_KEY] || null;
}

function setSavedFolder(folder) {
  saveSettings({ [EXPORT_FOLDER_KEY]: folder });
}

function uint8ToBase64(u8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ExportHarvestZipButton() {
  const t = useT();

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savedUri, setSavedUri] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [folder, setFolder] = useState(() => getSavedFolder());
  const [showConfirm, setShowConfirm] = useState(false);

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
      setStatus(`${t("msg_export_folder_set")} ${res.folder.name || ""}`);
    } catch (e) {
      setError(e?.message || t("err_choose_folder_failed"));
    }
  };

  const promptDeleteAfterExport = () => setShowConfirm(true);

  const doDelete = () => {
    clearAllPhotos();
    setShowConfirm(false);
    setStatus(t("status_deleted"));
  };

  const keepForLater = () => {
    setShowConfirm(false);
    setStatus(t("status_kept"));
  };

  const exportZip = async () => {
    setStatus("");
    setError("");
    setSavedUri("");
    setIsBusy(true);

    try {
      const data = safeParse(localStorage.getItem(PHOTOS_KEY));
      const itemKeys = Object.keys(data || {});
      if (itemKeys.length === 0) throw new Error(t("err_no_photos"));

      const zip = new JSZip();

      for (const itemKey of itemKeys) {
        const photos = data[itemKey] || [];
        photos.forEach((p, i) => {
          const parsed = splitDataUrl(p?.dataUrl);
          if (!parsed) return;
          const ext =
            parsed.mime === "image/png" ? "png" :
            parsed.mime === "image/webp" ? "webp" : "jpg";
          zip.file(
            `${itemKey}/photo_${String(i + 1).padStart(3, "0")}.${ext}`,
            parsed.base64,
            { base64: true }
          );
        });
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `harvest_photos_${ts}.zip`;

      if (!isNative) {
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, filename);
        setStatus(t("status_exported_ok"));
        promptDeleteAfterExport();
        return;
      }

      if (!folder?.id) throw new Error(t("err_no_export_folder"));

      const zipBytes = await zip.generateAsync({ type: "uint8array" });
      const base64Zip = uint8ToBase64(zipBytes);

      const exportDir = "HarvestExports";
      await ScopedStorage.mkdir({ folder, path: exportDir, recursive: true }).catch(() => {});

      const relPath = `${exportDir}/${filename}`;

      await ScopedStorage.writeFile({
        folder,
        path: relPath,
        data: base64Zip,
        encoding: "base64",
        mimeType: "application/zip",
      });

      const uriRes = await ScopedStorage.getUriForPath({ folder, path: relPath });
      setSavedUri(uriRes?.uri || "");
      setStatus(t("status_exported_ok"));
      promptDeleteAfterExport();
    } catch (e) {
      setError(e?.message || t("err_export_failed"));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {isNative && (
        <button onClick={chooseFolder} disabled={isBusy || showConfirm}>
          {t("choose_export_folder")}
        </button>
      )}

      {isNative && folder?.id && (
        <div className="alert">
          <strong>{t("export_folder_label")}:</strong> {folder.name}
        </div>
      )}

      <button onClick={exportZip} disabled={isBusy || showConfirm}>
        {isBusy ? t("exporting") : t("export_zip")}
      </button>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {savedUri && (
        <div className="alert">
          <strong>{t("saved_uri")}:</strong> {savedUri}
        </div>
      )}

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h4>{t("confirm_delete_title")}</h4>
            <p>{t("confirm_delete_body_1")}</p>
            <p>{t("confirm_delete_body_2")}</p>
            <div className="actions">
              <button onClick={keepForLater}>{t("no_keep_for_later")}</button>
              <button className="primary" onClick={doDelete}>{t("yes_delete")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
