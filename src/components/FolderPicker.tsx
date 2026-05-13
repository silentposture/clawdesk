import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { hasTauriRuntime, pickProjectFolder } from "../lib/tauri";
import { useI18n } from "../lib/i18n";

interface FolderPickerProps {
  label: string;
  value: string;
  helperText: string;
  onSelect: (value: string) => void;
}

function extractFolderName(event: ChangeEvent<HTMLInputElement>): string | undefined {
  const files = event.target.files;
  if (!files || files.length === 0) return undefined;
  const first = files.item(0);
  if (!first) return undefined;

  const relative = (first as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (relative) {
    const [folderName] = relative.split("/");
    if (folderName) return folderName;
  }

  return first.name;
}

export function FolderPicker({ label, value, helperText, onSelect }: FolderPickerProps): JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const input = fileInput.current;
    if (!input || hasTauriRuntime()) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("mozdirectory", "");
    input.setAttribute("multiple", "");
  }, []);

  async function handlePick() {
    setError(undefined);
    setLoading(true);

    if (hasTauriRuntime()) {
      try {
        const picked = await pickProjectFolder();
        if (picked) onSelect(picked);
      } catch (selectError) {
        setError(selectError instanceof Error ? selectError.message : t("app.folderPicker.error"));
      } finally {
        setLoading(false);
      }
      return;
    }

    fileInput.current?.click();
    setLoading(false);
  }

  function handleFallbackFolder(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    const picked = extractFolderName(event);
    if (!picked) {
      setError(t("app.folderPicker.title"));
      return;
    }
    onSelect(picked);
  }

  return (
    <label className="folder-picker">
      <span>{label}</span>
      <div className="folder-picker-row">
        <input className="folder-picker-input" value={value} readOnly />
        <button className="secondary-button" type="button" onClick={handlePick} disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={15} />
              {t("app.folderPicker.browse")}
            </>
          ) : (
            <>
              <FolderOpen size={15} />
              {t("app.folderPicker.choose")}
            </>
          )}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        onChange={handleFallbackFolder}
        style={{ display: "none" }}
        onClick={(event) => {
          const target = event.target as HTMLInputElement;
          target.value = "";
        }}
      />
      <small>{t("app.folderPicker.current", { value })}</small>
      <small>{error ?? helperText}</small>
    </label>
  );
}
