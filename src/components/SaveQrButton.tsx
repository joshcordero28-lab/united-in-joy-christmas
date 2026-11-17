"use client";

type Props = {
  qrDataUrl: string;
  fileName?: string;
  className?: string;
  label?: string;
};

/** Optional download of an already-rendered QR data URL. Never required. */
export function SaveQrButton({
  qrDataUrl,
  fileName = "united-in-joy-ticket-qr.png",
  className = "btn btn-secondary w-full",
  label = "Save QR Code",
}: Props) {
  function onSave() {
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <button type="button" className={className} onClick={onSave}>
      {label}
    </button>
  );
}
