import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { getItemAndHarvestByKey, appendHarvestLog, updateHarvestLogByRow } from "../api/sheetsApi";
import { loadSettings, onSettingsChange } from "../store/settingsStore";
import HarvestCapture from "../components/HarvestCapture";
import ExportHarvestZipButton from "../components/ExportHarvestZipButton";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function HarvestManagementPage() {
  const [settings, setSettings] = useState(loadSettings());

  const [step, setStep] = useState("idle"); // idle | scanning | loaded
  const [status, setStatus] = useState("");

  const [headers, setHeaders] = useState([]);
  const [itemKey, setItemKey] = useState("");
  const [item, setItem] = useState(null);

  const [harvestExists, setHarvestExists] = useState(false);
  const [harvestRow, setHarvestRow] = useState(null);

  const [harvestForm, setHarvestForm] = useState({
    harvestingDate: today(),
    numberOfShoot: "",
    shoot1Length: "",
    shoot2Length: "",
  });

  const [processingForm, setProcessingForm] = useState({
    processingDate: today(),
    xLarge: "",
    large: "",
    medium: "",
    small: "",
    orCount: "",
  });

  const scannerRef = useRef(null);

  useEffect(() => {
    return onSettingsChange(setSettings);
  }, []);

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current.clear();
      scannerRef.current = null;
    }
  }

  async function startScan() {
    setStatus("");
    setStep("scanning");

    setTimeout(() => {
      const el = document.getElementById("harvest-reader");
      if (!el) {
        setStatus("Scanner container not ready.");
        return;
      }

      const scanner = new Html5Qrcode("harvest-reader");
      scannerRef.current = scanner;

      scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
          stopScanner();
          await handleScannedKey(decodedText.trim());
        },
        () => {}
      );
    }, 0);
  }

  async function handleScannedKey(key) {
    try {
      setStatus("Loading item...");
      const r = await getItemAndHarvestByKey(key);

      // ✅ FLAT RESPONSE SHAPE (MATCHES APPS SCRIPT)
      if (!r?.itemFound) {
        throw new Error("Item not found.");
      }

      setHeaders(r.itemHeaders || []);
      setItemKey(key);
      setItem(r.item || null);

      if (r.harvestFound) {
        setHarvestExists(true);
        setHarvestRow(r.harvestRow);

        setHarvestForm({
          harvestingDate: r.harvest?.harvestingDate || today(),
          numberOfShoot: r.harvest?.numberOfShoot || "",
          shoot1Length: r.harvest?.shoot1Length || "",
          shoot2Length: r.harvest?.shoot2Length || "",
        });

        setProcessingForm({
          processingDate: r.harvest?.processingDate || today(),
          xLarge: r.harvest?.numberXL ?? "",
          large: r.harvest?.numberL ?? "",
          medium: r.harvest?.numberM ?? "",
          small: r.harvest?.numberS ?? "",
          orCount: r.harvest?.numberOR ?? "",
        });

        setStatus("Harvest record loaded.");
      } else {
        setHarvestExists(false);
        setHarvestRow(null);
        setStatus("No harvest record yet.");
      }

      setStep("loaded");
    } catch (err) {
      setStatus(err.message || String(err));
      setStep("idle");
    }
  }

  async function saveHarvest() {
    try {
      setStatus("Saving...");
      if (!settings?.harvestSpreadsheetId || !settings?.harvestSheetName) {
        throw new Error("Harvest sheet not configured.");
      }

      if (!harvestExists) {
        await appendHarvestLog({
          spreadsheetId: settings.harvestSpreadsheetId,
          sheetName: settings.harvestSheetName,
          itemKey,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          photoCount: 0,
        });
      } else {
        await updateHarvestLogByRow({
          spreadsheetId: settings.harvestSpreadsheetId,
          sheetName: settings.harvestSheetName,
          rowIndex: harvestRow,
          harvestingDate: harvestForm.harvestingDate,
          numberOfShoot: harvestForm.numberOfShoot,
          shoot1Length: harvestForm.shoot1Length,
          shoot2Length: harvestForm.shoot2Length,
          processingDate: processingForm.processingDate,
          xLarge: processingForm.xLarge,
          large: processingForm.large,
          medium: processingForm.medium,
          small: processingForm.small,
          orCount: processingForm.orCount,
        });
      }

      setStatus("Saved successfully.");
      resetToIdle();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  function resetToIdle() {
    stopScanner();
    setStep("idle");
    setItemKey("");
    setItem(null);
    setHarvestExists(false);
    setHarvestRow(null);
  }

  return (
    <div className="page">
      <h2>Harvest Management</h2>

      {step === "idle" && (
        <button onClick={startScan}>Start Scan</button>
      )}

      {step === "scanning" && (
        <div id="harvest-reader" style={{ width: 300 }} />
      )}

      {step === "loaded" && (
        <>
          <div className="panel">
            <h3>Item</h3>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </div>

          <div className="panel">
            <h3>Harvest</h3>

            <label>Date</label>
            <input
              type="date"
              value={harvestForm.harvestingDate}
              onChange={(e) =>
                setHarvestForm({ ...harvestForm, harvestingDate: e.target.value })
              }
            />

            <label># Shoots</label>
            <input
              value={harvestForm.numberOfShoot}
              onChange={(e) =>
                setHarvestForm({ ...harvestForm, numberOfShoot: e.target.value })
              }
            />

            <button onClick={saveHarvest}>Save</button>
            <button onClick={resetToIdle}>Scan Another</button>
          </div>

          <HarvestCapture itemKey={itemKey} />
        </>
      )}

      <ExportHarvestZipButton />

      {status && <p className="status">{status}</p>}
    </div>
  );
}
