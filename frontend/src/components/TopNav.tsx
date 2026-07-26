import { useEffect, useRef, useState } from "react";
import { TopNav as AstryxTopNav, TopNavHeading, Button, Selector } from "@astryxdesign/core";
import { getAuthToken } from "../api/client";
import { useStore } from "../store/useStore";

async function exportScript(scriptId: number) {
  const token = getAuthToken();
  const res = await fetch(`/api/scripts/${scriptId}/export/?fmt=docx`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `script_${scriptId}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TopNav() {
  const { script, scripts, loadScript, importScript, undo, isChatOpen, toggleChat } = useStore();
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

  const scriptOptions = scripts.map((s) => ({
    value: String(s.id),
    label: s.title,
  }));

  return (
    <AstryxTopNav
      heading={<TopNavHeading>ScriptEdit</TopNavHeading>}
      startContent={
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "240px" }}>
          {scripts.length > 0 && (
            <Selector
              label="Select script"
              isLabelHidden
              value={script ? String(script.id) : ""}
              options={scriptOptions}
              onChange={(val) => loadScript(Number(val))}
              size="sm"
            />
          )}
        </div>
      }
      endContent={
        <div className="topnav-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            label="AI Assistant"
            variant={isChatOpen ? "primary" : "secondary"}
            size="sm"
            onClick={toggleChat}
          />
          <Button
            label={importing ? "Importing…" : "Import"}
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            isDisabled={importing}
          />
          {script && (
            <Button
              label="Export"
              variant="primary"
              size="sm"
              onClick={() => exportScript(script.id)}
            />
          )}
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
        </div>
      }

    />
  );
}


