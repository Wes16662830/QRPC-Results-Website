import { useState } from "react";
import { get } from "./api";

/** Export bar: CSV download(s), print-to-PDF, and a WhatsApp-ready text summary. */
export function ExportBar({ csv, whatsappPath }: { csv: [string, string][]; whatsappPath?: string }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function shareWhatsApp() {
    if (!whatsappPath) return;
    const { text } = await get<{ text: string }>(whatsappPath);
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Summary copied. Paste it into WhatsApp, or use the WhatsApp button.");
    } catch {
      setMsg(null);
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  return (
    <div className="no-print mb-4">
      <div className="flex flex-wrap gap-2">
        {whatsappPath && (
          <button className="btn" onClick={shareWhatsApp}>
            WhatsApp
          </button>
        )}
        {csv.map(([href, label]) => (
          <a key={href} className="btn" href={href} download>
            {label}
          </a>
        ))}
        <button className="btn" onClick={() => window.print()}>
          PDF / Print
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </div>
  );
}
