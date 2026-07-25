import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "../api/client";
import { useStore } from "../store/useStore";

async function exportScript(scriptId: number) {
  const token = getAuthToken();
  const res = await fetch(`/api/scripts/${scriptId}/export/?fmt=text`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  });
  const text = await res.text();
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `script_${scriptId}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TopNav() {
  const { script, scripts, project, loadScript, importScript, undo } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".ProseMirror") || target.closest("input, textarea, select")) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      await importScript(file);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <nav className="topnav">
      <span className="topnav-brand">ScriptEdit</span>
      <select
        className="script-switcher"
        value={script?.id ?? ""}
        onChange={(e) => loadScript(Number(e.target.value))}
        title={`${project?.name ?? ""} — select script`}
      >
        {scripts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <span style={{ flex: 1 }} />
      <div className="topnav-actions">
        <button
          className="nav-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import"}
        </button>
        {script && (
          <button className="nav-btn" onClick={() => exportScript(script.id)}>
            Export
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportFile(file);
          e.target.value = "";
        }}
      />
    </nav>
  );
}
