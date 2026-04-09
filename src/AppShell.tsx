import React, { useState } from "react";
import JsonFileUploader from "./JsonFileUploader";
import JsonDocumentCheckUploader from "./JsonDocumentCheckUploader";
import AccountsCheckUploader from "./AccountsCheckUploader";
import JsonUnlockDocumentUploader from "./JsonUnlockDocumentUploader";

type Mode = "fill" | "checkDoc" | "checkAccounts" | "unlockDoc";

const btn = (active: boolean) =>
  ({
    padding: "0.6rem 1rem",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.35)",
    background: active ? "white" : "rgba(255,255,255,0.15)",
    color: active ? "#1a202c" : "white",
    fontWeight: 700,
    cursor: "pointer",
  }) as const;

const AppShell: React.FC = () => {
  const [mode, setMode] = useState<Mode>("fill");

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(0,0,0,0.15)",
          backdropFilter: "blur(6px)",
          padding: "0.75rem 1rem",
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <button onClick={() => setMode("fill")} style={btn(mode === "fill")}>
          Заполнение (JSON)
        </button>
        <button
          onClick={() => setMode("checkDoc")}
          style={btn(mode === "checkDoc")}
        >
          Проверка документа (JSON)
        </button>
        <button
          onClick={() => setMode("checkAccounts")}
          style={btn(mode === "checkAccounts")}
        >
          Проверка аккаунтов (XLSX)
        </button>
        <button
          onClick={() => setMode("unlockDoc")}
          style={btn(mode === "unlockDoc")}
        >
          Снятие блокировки (JSON)
        </button>
      </div>

      {mode === "fill" && <JsonFileUploader />}
      {mode === "checkDoc" && <JsonDocumentCheckUploader />}
      {mode === "checkAccounts" && <AccountsCheckUploader />}
      {mode === "unlockDoc" && <JsonUnlockDocumentUploader />}
    </div>
  );
};

export default AppShell;

