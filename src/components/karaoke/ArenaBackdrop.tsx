import { useState } from "react";

/** Static scenery stays behind the interface, including the provider player. */
export function ArenaBackdrop({ state }: { state: "waiting" | "duel" | "victory" | null }) {
  if (!state) return null;
  // The brighter floor and arches keep the waiting stage visible across aspect ratios.
  const base = `/images/brand/pulso-arena-${state === "waiting" ? "duel" : state}`;
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
