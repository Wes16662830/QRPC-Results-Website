import { toBlob } from "html-to-image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { fmtDate, fmtPoints, fmtSpeed } from "../format";
import { useApi } from "../hooks";
import { useSeason } from "../season";
import { ErrorBox, Loading, Notice, PageTitle } from "../ui";

interface Row {
  rank: number;
  fancierId: number | null;
  fancierName: string;
  ring?: string;
  total: number;
  thisWeek: number;
  movement: number | "new" | null;
  behind: number;
}
interface Board {
  competition: { name: string; slug: string; unit: string };
  racesCounted: number;
  standings: Row[];
  total: number;
}
interface LeaderboardData {
  season: number;
  weeks: { id: number; name: string; date: string; week: number }[];
  week: {
    number: number;
    of: number;
    race: { id: number; name: string; date: string; basketed: number | null; returned: number };
    firstBird: { fancierName: string; ring: string; speed: number } | null;
    podium: { fancierName: string; score: number }[];
  } | null;
  club: Board | null;
  bird: Board | null;
}

/** The poster is laid out at a fixed width so the shared image always looks the same. */
const POSTER_W = 540;

// Fixed poster colours (an image looks the same whatever the viewer's theme).
const C = {
  bg: "#0d2238",
  bg2: "#12304f",
  panel: "rgba(255,255,255,0.06)",
  line: "rgba(255,255,255,0.10)",
  ink: "#f4f7fb",
  muted: "#a9b8c9",
  gold: "#f2b33d",
  silver: "#cfd8e3",
  bronze: "#d39060",
  up: "#5cd69a",
  down: "#ff8a80",
};

function Movement({ m }: { m: Row["movement"] }) {
  if (m === null) return <span style={{ color: C.muted }}>·</span>;
  if (m === "new") return <span style={{ color: C.gold, fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>NEW</span>;
  if (m === 0) return <span style={{ color: C.muted }}>–</span>;
  return (
    <span style={{ color: m > 0 ? C.up : C.down, fontWeight: 800 }}>
      {m > 0 ? "▲" : "▼"}
      {Math.abs(m)}
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? C.gold : rank === 2 ? C.silver : rank === 3 ? C.bronze : null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 13,
        fontWeight: 800,
        fontSize: 13,
        background: medal ?? "transparent",
        color: medal ? "#1b1300" : C.muted,
        border: medal ? "none" : `1px solid ${C.line}`,
      }}
    >
      {rank}
    </span>
  );
}

function Table({ board, bird }: { board: Board; bird: boolean }) {
  return (
    <div style={{ background: C.panel, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.3 }}>{board.competition.name}</div>
        <div style={{ fontSize: 11, color: C.muted }}>
          after {board.racesCounted} race{board.racesCounted === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 36px 52px 60px", columnGap: 6, fontSize: 10, color: C.muted, letterSpacing: 0.6, textTransform: "uppercase", padding: "4px 0" }}>
        <span />
        <span>{bird ? "Bird" : "Fancier"}</span>
        <span style={{ textAlign: "center" }}>+/-</span>
        <span style={{ textAlign: "right" }}>Week</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>
      {board.standings.map((s) => (
        <div
          key={s.ring ?? s.fancierId ?? s.fancierName}
          style={{
            display: "grid",
            gridTemplateColumns: "30px 1fr 36px 52px 60px",
            columnGap: 6,
            alignItems: "center",
            padding: "5px 0",
            borderTop: `1px solid ${C.line}`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <RankBadge rank={s.rank} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: s.rank <= 3 ? 800 : 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {bird ? s.ring : s.fancierName}
            </div>
            {bird && <div style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.fancierName}</div>}
          </div>
          <div style={{ textAlign: "center", fontSize: 12 }}>
            <Movement m={s.movement} />
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: s.thisWeek ? C.ink : C.muted }}>{s.thisWeek ? `+${fmtPoints(s.thisWeek)}` : "–"}</div>
          <div style={{ textAlign: "right", fontSize: 16, fontWeight: 800, color: s.rank === 1 ? C.gold : C.ink }}>{fmtPoints(s.total)}</div>
        </div>
      ))}
      {board.total > board.standings.length && (
        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", paddingTop: 6 }}>
          + {board.total - board.standings.length} more {bird ? "birds" : "fanciers"} on the site
        </div>
      )}
    </div>
  );
}

function Poster({ data }: { data: LeaderboardData }) {
  const w = data.week!;
  const place = ["1st", "2nd", "3rd"];
  const podiumColour = [C.gold, C.silver, C.bronze];
  return (
    <div
      style={{
        width: POSTER_W,
        color: C.ink,
        background: `radial-gradient(120% 60% at 100% 0%, ${C.bg2} 0%, ${C.bg} 60%)`,
        padding: 22,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/favicon.svg" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: C.gold, fontWeight: 800 }}>QUEENSTOWN RACING PIGEON CLUB</div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.05, letterSpacing: -0.3 }}>
            Week {w.number} leaderboard <span style={{ color: C.muted, fontWeight: 700 }}>· {data.season}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: C.muted }}>
        {w.race.name} · {fmtDate(w.race.date)} · {w.race.basketed ?? "?"} basketed · {w.race.returned} home
      </div>

      {/* Race of the week */}
      <div style={{ marginTop: 14, background: C.panel, borderRadius: 14, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.muted, fontWeight: 700 }}>RACE OF THE WEEK</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
          {w.podium.map((p, i) => (
            <div key={p.fancierName} style={{ borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.05)", borderTop: `3px solid ${podiumColour[i]}` }}>
              <div style={{ fontSize: 11, color: podiumColour[i], fontWeight: 800 }}>{place[i]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.fancierName}</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{fmtPoints(p.score)}</div>
            </div>
          ))}
        </div>
        {w.firstBird && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
            First bird home: <strong style={{ color: C.ink }}>{w.firstBird.fancierName}</strong> · {w.firstBird.ring} · {fmtSpeed(w.firstBird.speed)} m/min
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {data.club && <Table board={data.club} bird={false} />}
        {data.bird && <Table board={data.bird} bird />}
      </div>

      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
        <span>
          After race {w.number} of {w.of}
        </span>
        <span>{window.location.host}</span>
      </div>
    </div>
  );
}

/** Scales the fixed-width poster down to fit small screens (the exported image stays full size). */
function FitToWidth({ children, innerRef }: { children: React.ReactNode; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const w = outer.current?.clientWidth ?? POSTER_W;
      const s = Math.min(1, w / POSTER_W);
      setScale(s);
      setHeight((innerRef.current?.offsetHeight ?? 0) * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [innerRef]);
  return (
    <div ref={outer} style={{ width: "100%", maxWidth: POSTER_W, height, margin: "0 auto" }}>
      <div ref={innerRef} style={{ width: POSTER_W, transform: `scale(${scale})`, transformOrigin: "top left", borderRadius: 18, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
        {children}
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  const { season } = useSeason();
  const [params, setParams] = useSearchParams();
  const race = params.get("race");
  const { data, error } = useApi<LeaderboardData>(season ? `/api/leaderboard?season=${season}${race ? `&race=${race}` : ""}` : null);
  const posterRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setMsg(null), [race, season]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.week) {
    return (
      <>
        <PageTitle title="Weekly leaderboard" />
        <Notice tone="info">No results have been published for {data.season} yet.</Notice>
      </>
    );
  }
  const w = data.week;
  const filename = `qrpc-${data.season}-week-${w.number}-leaderboard.png`;

  async function makeImage(): Promise<Blob> {
    // Export the unscaled poster at 2x for a crisp ~1080 px wide image.
    const node = posterRef.current!.firstElementChild as HTMLElement;
    // toBlob (not toPng + fetch): the site's security policy doesn't allow fetching data: URLs.
    const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true });
    if (!blob) throw new Error("the browser could not draw the image");
    return blob;
  }

  async function download() {
    setBusy(true);
    try {
      const blob = await makeImage();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setMsg(`Could not create the image: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const file = new File([await makeImage()], filename, { type: "image/png" });
      const text = `QRPC ${data!.season} – week ${w.number} leaderboard (${w.race.name})`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        await download();
        setMsg("Sharing images isn't supported on this device, so the image was downloaded instead.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg(`Could not share: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const club = data.club;
  const waText = [
    `*QRPC ${data.season} – Week ${w.number} leaderboard*`,
    `${w.race.name} (${fmtDate(w.race.date)})`,
    "",
    club ? `*${club.competition.name}*` : "",
    ...(club?.standings.slice(0, 5).map((s) => `${s.rank}. ${s.fancierName} – ${fmtPoints(s.total)} pts`) ?? []),
    data.bird ? `\n*${data.bird.competition.name}*` : "",
    ...(data.bird?.standings.slice(0, 3).map((s) => `${s.rank}. ${s.ring} (${s.fancierName}) – ${fmtPoints(s.total)} pts`) ?? []),
    "",
    `${window.location.origin}/leaderboard?season=${data.season}&race=${w.race.id}`,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");

  return (
    <>
      <PageTitle
        title="Weekly leaderboard"
        sub={
          <span>
            Week {w.number} · <Link className="underline" to={`/races/${w.race.id}`}>{w.race.name}</Link>
          </span>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" aria-label="Week" value={w.race.id} onChange={(e) => setParams({ race: e.target.value })}>
          {data.weeks.map((x) => (
            <option key={x.id} value={x.id}>
              Week {x.week} · {x.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={busy} onClick={share}>
          {busy ? "Working…" : "Share"}
        </button>
        <button className="btn" disabled={busy} onClick={download}>
          Download image
        </button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener">
          WhatsApp text
        </a>
      </div>
      {msg && <p className="no-print mb-3 text-sm text-muted">{msg}</p>}
      <FitToWidth innerRef={posterRef}>
        <Poster data={data} />
      </FitToWidth>
    </>
  );
}
