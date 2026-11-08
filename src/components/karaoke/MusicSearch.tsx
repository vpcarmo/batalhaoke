import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider, DEFAULT_PROVIDER } from "@/lib/playback/registry";
import type { PlaybackSearchResult } from "@/lib/playback/types";
import { getVenueTopSongsFn } from "@/lib/playback/venue-top-songs.functions";
import { useServerFn } from "@tanstack/react-start";

/** Explicit-action search: typing never calls the API; only the button/Enter does. */
export function MusicSearch({
  onPick,
  onSearched,
  venueId,
}: {
  onPick: (r: PlaybackSearchResult) => void;
  onSearched?: () => void;
  venueId?: string | null;
}) {
  const [tab, setTab] = useState<"search" | "top">("search");
  const [q, setQ] = useState("");
  const [lastQ, setLastQ] = useState("");
  const [results, setResults] = useState<PlaybackSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getTopSongs = useServerFn(getVenueTopSongsFn);
  const topSongs = useQuery({
    queryKey: ["venue-top-songs", venueId],
    queryFn: () => getTopSongs({ data: { venueId: venueId! } }),
    enabled: tab === "top" && !!venueId,
    staleTime: 5 * 60 * 1000,
  });

  async function run() {
    const term = q.trim();
    if (!term || loading || term === lastQ) return; // no empty or duplicate searches
    setLoading(true);
    setErr(null);
    try {
      const r = await getProvider(DEFAULT_PROVIDER).search(term);
      setResults(r);
      setLastQ(term);
    } catch (e) {
      setErr((e as Error).message || "Falha na pesquisa.");
      setResults(null);
    } finally {
      setLoading(false);
      onSearched?.();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {venueId && (
        <div
          role="tablist"
          aria-label="Músicas"
          className="grid grid-cols-2 rounded-lg bg-muted p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            className={`rounded-md px-3 py-2 text-sm ${tab === "search" ? "bg-background shadow" : "text-muted-foreground"}`}
            onClick={() => setTab("search")}
          >
            Buscar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "top"}
            className={`rounded-md px-3 py-2 text-sm ${tab === "top" ? "bg-background shadow" : "text-muted-foreground"}`}
            onClick={() => setTab("top")}
          >
            Mais tocadas
          </button>
        </div>
      )}
      {tab === "search" && (
        <>
          <div className="flex flex-row gap-2">
            <label htmlFor="q" className="sr-only">
              Música
            </label>
            <Input
              id="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void run();
                }
              }}
              placeholder="Ex.: Evidências, Menina Veneno, Leão..."
              className="h-11 min-w-0 flex-1 text-base"
              autoComplete="off"
            />
            <Button
              type="button"
              className="h-11 shrink-0"
              disabled={!q.trim() || loading || q.trim() === lastQ}
              onClick={() => void run()}
            >
              <Search className="size-4" />{" "}
              {loading
                ? "Pesquisando…"
                : q.trim()
                  ? `Pesquisar "${q.trim().slice(0, 18)}"`
                  : "Pesquisar"}
            </Button>
          </div>
          {err && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
              {err}
            </p>
          )}
          {results && results.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              Nenhum resultado incorporável para "{lastQ}".
            </p>
          )}
          {results && results.length > 0 && (
            <ul
              aria-label="Resultados da pesquisa"
              className="grid max-h-[38dvh] gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[44dvh] sm:grid-cols-2"
            >
              {results.map((r) => (
                <li key={r.externalId} className="overflow-hidden rounded-xl border bg-card">
                  {r.thumbnailUrl && (
                    <img
                      src={r.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      width={320}
                      height={180}
                      className="aspect-video max-h-28 w-full object-cover"
                    />
                  )}
                  <div className="flex flex-col gap-1 p-2">
                    <p className="line-clamp-2 font-semibold leading-snug">{r.title}</p>
                    <p className="text-sm text-muted-foreground">Canal: {r.channelName ?? "—"}</p>
                    {r.duration && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" /> {r.duration}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="mt-2 h-11"
                      disabled={loading}
                      onClick={() => onPick(r)}
                    >
                      Selecionar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {tab === "top" && (
        <>
          {topSongs.isPending && (
            <p className="text-sm text-muted-foreground">Carregando ranking…</p>
          )}
          {topSongs.isError && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {topSongs.error.message || "Não foi possível carregar as mais tocadas."}
            </p>
          )}
          {topSongs.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ainda não há músicas com reproduções válidas neste estabelecimento.
            </p>
          )}
          {!!topSongs.data?.length && (
            <ul
              aria-label="Músicas mais tocadas"
              className="grid max-h-[38dvh] gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[44dvh] sm:grid-cols-2"
            >
              {topSongs.data.map(({ result, playCount }) => (
                <li
                  key={`${result.provider}:${result.externalId}`}
                  className="overflow-hidden rounded-xl border bg-card"
                >
                  {result.thumbnailUrl && (
                    <img
                      src={result.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      width={320}
                      height={180}
                      className="aspect-video max-h-28 w-full object-cover"
                    />
                  )}
                  <div className="flex flex-col gap-1 p-2">
                    <p className="line-clamp-2 font-semibold leading-snug">{result.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Canal: {result.channelName ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {playCount} {playCount === 1 ? "reprodução" : "reproduções"}
                    </p>
                    <Button type="button" className="mt-2 h-11" onClick={() => onPick(result)}>
                      Selecionar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
