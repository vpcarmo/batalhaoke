import { useState } from "react";

/** Decorative scenery is never mounted while the provider player is visible. */
export function ArenaBackdrop({ state }: { state: "waiting" | "duel" | "victory" | null }) {
  if (!state) return null;
  const base = `/images/brand/pulso-arena-${state}`;
  return <ArenaImage key={state} base={base} />;
}

function ArenaImage({ base }: { base: string }) {
  const [jpegOnly, setJpegOnly] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <picture className="pulso-arena-backdrop" aria-hidden="true">
      {!jpegOnly && <source srcSet={`${base}.webp`} type="image/webp" />}
      {!failed && (
        <img
          src={`${base}.jpg`}
          alt=""
          width={1920}
          height={1080}
          onError={() => {
            if (!jpegOnly) setJpegOnly(true);
            else setFailed(true);
          }}
        />
      )}
    </picture>
  );
}
