import { useMemo, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Capacitor } from "@capacitor/core";
import { ScopedStorage } from "@daniele-rolli/capacitor-scoped-storage";
import { clearAllPhotos } from "../store/harvestStore";
import { loadSettings, saveSettings } from "../store/settingsStore";
import { useT } from "../i18n";

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
  const { t } = useT();

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savedUri, setSavedUri] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [folder, setFolder] = useState(() => getSavedFolder());

  // Confirmation modal state
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
      setStatus(`${t("msg_export_folder_set")} ${res.folder.name || "Selected folder"}`);
    } catch (e) {
      setError(e?.message || t("err_choose_folder_failed"));
    }
  };

  // Called ONLY after successful export
  const promptDeleteAfterExport = () => {
    setShowConfirm(true);
  };

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

      let totalPhotos = 0;
      for (const k of itemKeys) totalPhotos += (data[k] || []).length;
      if (totalPhotos === 0) throw new Error(t("err_no_photos"));

      const zip = new JSZip();

      for (const itemKey of itemKeys) {
        const photos = data[itemKey] || [];
        for (let i = 0; i < photos.length; i++) {
          const parsed = splitDataUrl(photos[i]?.dataUrl);
          if (!parsed) continue;

          const ext =
            parsed.mime === "image/png" ? "png" : parsed.mime === "image/webp" ? "webp" : "jpg";

          zip.file(`${itemKey}/photo_${String(i + 1).padStart(3, "0")}.${ext}`, parsed.base64, {
            base64: true,
          });
        }
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      let filename = `harvest_photos_${ts}.zip`;
      if (!filename.toLowerCase().endsWith(".zip")) filename += ".zip";

      // ---------- WEB EXPORT ----------
      if (!isNative) {
        setStatus(t("exporting"));
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, filename);

        setStatus(t("status_exported_ok"));
        promptDeleteAfterExport();
        return;
      }

      // ---------- NATIVE EXPORT (Capacitor) ----------
      if (!folder?.id) {
        setError(t("err_no_export_folder"));
        return;
      }

      setStatus(t("status_creating_zip"));

      const zipBytes = await zip.generateAsync({ type: "uint8array" });
      const base64Zip = uint8ToBase64(zipBytes);

      const exportDir = "HarvestExports";
      try {
        await ScopedStorage.mkdir({ folder, path: exportDir, recursive: true });
      } catch {
        // ignore
      }

      const relPath = `${exportDir}/${filename}`;

      setStatus(t("status_saving_zip"));

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
      setStatus("");
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
        <div className="alert" style={{ wordBreak: "break-word" }}>
          <strong>{t("export_folder_label")}</strong> {folder?.name || "Selected folder"}
        </div>
      )}

      <button onClick={exportZip} disabled={isBusy || showConfirm}>
        {isBusy ? t("exporting") : t("export_zip")}
      </button>

      {status && <div className="alert">{status}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {savedUri && (
        <div className="alert" style={{ wordBreak: "break-word" }}>
          <strong>{t("saved_uri")}</strong> {savedUri}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{t("usb_copy_hint")}</div>
        </div>
      )}

      {/* Custom confirm modal (Yes / No) */}
      {showConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 14,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              maxWidth: 360,
              width: "100%",
              boxShadow: "0 10px 30px rgba(0,0,0,.25)",
              border: "1px solid #e6e6e6",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 10 }}>{t("confirm_delete_title")}</div>

            <div style={{ fontSize: 14, lineHeight: 1.4, marginBottom: 16 }}>
              {t("confirm_delete_body_1")}
              <br />
              {t("confirm_delete_body_2")}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={keepForLater}>{t("no_keep_for_later")}</button>
              <button className="primary" onClick={doDelete}>
                {t("yes_delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
