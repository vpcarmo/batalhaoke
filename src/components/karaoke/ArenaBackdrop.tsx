/** Decorative scenery is never mounted while the provider player is visible. */
export function ArenaBackdrop({ state }: { state: "waiting" | "duel" | "victory" | null }) {
  if (!state) return null;
  const base = `/images/brand/pulso-arena-${state}`;
  return (
    <picture className="pulso-arena-backdrop" aria-hidden="true">
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img src={`${base}.jpg`} alt="" width={1920} height={1080} />
    </picture>
  );
}
