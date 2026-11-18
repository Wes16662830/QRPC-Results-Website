import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { get } from "./api";

interface SeasonState {
  /** The selected season, or null while loading. */
  season: number | null;
  seasons: number[];
  setSeason: (s: number) => void;
}

const SeasonContext = createContext<SeasonState>({ season: null, seasons: [], setSeason: () => {} });
const KEY = "qrpc.season";

/**
 * Holds the season chosen in the header. Defaults to the latest season with races; a choice lasts for this
 * browser tab only, so the next visit opens on the newest season again.
 */
export function SeasonProvider({ children }: { children: ReactNode }) {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeasonState] = useState<number | null>(null);

  useEffect(() => {
    get<{ seasons: number[]; current: number }>("/api/seasons")
      .then((r) => {
        const list = r.seasons.length ? r.seasons : [r.current];
        setSeasons(list);
        let saved: number | null = null;
        try {
          saved = Number(sessionStorage.getItem(KEY)) || null;
        } catch {
          saved = null;
        }
        setSeasonState(saved && list.includes(saved) ? saved : r.current);
      })
      .catch(() => {
        const y = new Date().getFullYear();
        setSeasons([y]);
        setSeasonState(y);
      });
  }, []);

  const setSeason = (s: number) => {
    setSeasonState(s);
    setSeasons((list) => (list.includes(s) ? list : [...list, s].sort((a, b) => b - a)));
    try {
      sessionStorage.setItem(KEY, String(s));
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  return <SeasonContext.Provider value={{ season, seasons, setSeason }}>{children}</SeasonContext.Provider>;
}

export const useSeason = () => useContext(SeasonContext);

/** Season dropdown for the header. Hidden while there is only one season. */
export function SeasonSelect({ className = "" }: { className?: string }) {
  const { season, seasons, setSeason } = useSeason();
  if (season === null || seasons.length < 2) {
    return season === null ? null : <span className={`text-sm font-semibold opacity-90 ${className}`}>{season}</span>;
  }
  return (
    <select
      aria-label="Season"
      className={`rounded-md border border-white/30 bg-white/10 px-2 py-1 text-sm font-semibold text-brand-ink ${className}`}
      value={season}
      onChange={(e) => setSeason(Number(e.target.value))}
    >
      {seasons.map((s) => (
        <option key={s} value={s} className="text-ink">
          {s}
        </option>
      ))}
    </select>
  );
}
