import React, { useState } from "react";
import JsonFileUploader from "./JsonFileUploader";
import AccountsCheckUploader from "./AccountsCheckUploader";

type Mode = "fill" | "check";

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
          gap: "0.75rem",
        }}
      >
        <button
          onClick={() => setMode("fill")}
          style={{
            padding: "0.6rem 1rem",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.35)",
            background: mode === "fill" ? "white" : "rgba(255,255,255,0.15)",
            color: mode === "fill" ? "#1a202c" : "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Заполнение (JSON)
        </button>
        <button
          onClick={() => setMode("check")}
          style={{
            padding: "0.6rem 1rem",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.35)",
            background: mode === "check" ? "white" : "rgba(255,255,255,0.15)",
            color: mode === "check" ? "#1a202c" : "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Проверка аккаунтов (XLSX)
        </button>
      </div>

      {mode === "fill" ? <JsonFileUploader /> : <AccountsCheckUploader />}
    </div>
  );
};

export default AppShell;

