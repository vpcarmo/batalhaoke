import { QRCodeSVG } from "qrcode.react";

export const voteUrl = (code: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/votar/${code}`;

/** QR code for the session's permanent voting link (generated locally, no external service). */
export function SessionQr({ code, size = 220, id }: { code: string; size?: number; id?: string }) {
  return (
    <div className="session-qr inline-block rounded-xl bg-white p-3">
      <QRCodeSVG id={id} value={voteUrl(code)} size={size} level="M" marginSize={4} />
    </div>
  );
}
