"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getProfiles, getMeals, getMealsSince, addMeal, deleteMeal, updateMeal, type Profile, type Meal } from "@/lib/db";
import { sumMacros, todayISO, getLast7Days, fmtShort, fmtWeek, fmtMonth, getWeekStart, DAILY_GOAL, PROTEIN_GOAL } from "@/lib/utils";

// ── helpers ───────────────────────────────────────────────────────────────────
function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      URL.revokeObjectURL(url);
      res({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = rej;
    img.src = url;
  });
}

function offsetDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, "0");
  const nd = String(dt.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

// ── CalorieRing ───────────────────────────────────────────────────────────────
function CalorieRing({ eaten, goal }: { eaten: number; goal: number }) {
  const pct = Math.min(eaten / goal, 1), r = 48, cx = 56, cy = 56, circ = 2 * Math.PI * r;
  const color = pct > 1 ? "#E24B4A" : pct > 0.85 ? "#EF9F27" : "#1D9E75";
  return (
    <svg width={112} height={112} viewBox="0 0 112 112">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={9} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={9}
        strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray .5s" }} />
      <text x={cx} y={cy - 7} textAnchor="middle" fontSize={18} fontWeight={500} fill="currentColor">{eaten}</text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize={10} fill="#9ca3af">of {goal}</text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize={9} fill="#9ca3af">kcal</text>
    </svg>
  );
}

// ── MiniChart ─────────────────────────────────────────────────────────────────
function MiniChart({ data, color, goal, label, unit, onBarClick, viewMode }: {
  data: { date: string; value: number }[];
  color: string; goal: number; label: string; unit: string;
  onBarClick: () => void; viewMode: "day" | "week";
}) {
  const nonZero = data.filter(d => d.value > 0);
  const weekAvg = nonZero.length ? Math.round(nonZero.reduce((a, d) => a + d.value, 0) / nonZero.length) : 0;
  const displayData = viewMode === "day" ? data : [{ date: data[data.length - 1]?.date ?? "", value: weekAvg }];
  const max = Math.max(...displayData.map(d => d.value), goal * 1.1, 1);
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span>Goal: {goal} {unit}</span>
      </div>
      <div className="flex items-end gap-1 h-24 relative">
        <div className="absolute left-0 right-0 border-t border-dashed opacity-40"
          style={{ bottom: `${(goal / max) * 100}%`, borderColor: color }} />
        {displayData.map((d, i) => {
          const pct = (d.value / max) * 100;
          const isToday = viewMode === "day" ? i === displayData.length - 1 : true;
          return (
            <div key={d.date + i} onClick={() => d.value > 0 && onBarClick()}
              className="flex-1 flex flex-col justify-end h-full cursor-pointer relative">
              {d.value > 0 && (
                <div className="absolute w-full text-center"
                  style={{ bottom: `${Math.max(pct, 2)}%`, fontSize: 8, color, fontWeight: 600, paddingBottom: 2 }}>
                  {d.value}
                </div>
              )}
              <div className="w-full rounded-t-sm transition-opacity"
                style={{ height: `${Math.max(pct, 2)}%`, background: color, opacity: isToday ? 1 : 0.5, border: isToday ? `1.5px solid ${color}` : "none" }} />
            </div>
          );
        })}
      </div>
      {viewMode === "day" ? (
        <div className="flex gap-1 mt-1">
          {data.map((d, i) => (
            <div key={d.date} className="flex-1 text-center"
              style={{ fontSize: 9, color: i === data.length - 1 ? "#374151" : "#9ca3af", fontWeight: i === data.length - 1 ? 600 : 400 }}>
              {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "narrow" })}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center mt-1" style={{ fontSize: 9, color: "#9ca3af" }}>7-day avg</div>
      )}
    </div>
  );
}

// ── AnalyticsTable ────────────────────────────────────────────────────────────
function AnalyticsTable({ meals, onClose }: { meals: Meal[]; onClose: () => void }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const rows = useMemo(() => {
    const byDate: Record<string, Meal[]> = {};
    meals.forEach(m => { byDate[m.meal_date] = byDate[m.meal_date] || []; byDate[m.meal_date].push(m); });
    if (period === "day") {
      return Object.entries(byDate)
        .map(([date, ms]) => ({ key: date, label: fmtShort(date), ...sumMacros(ms), days: 1 }))
        .sort((a, b) => b.key.localeCompare(a.key));
    }
    if (period === "week") {
      const bw: Record<string, { meals: Meal[]; dates: string[] }> = {};
      Object.entries(byDate).forEach(([date, ms]) => {
        const ws = getWeekStart(date);
        bw[ws] = bw[ws] || { meals: [], dates: [] };
        bw[ws].meals.push(...ms); bw[ws].dates.push(date);
      });
      return Object.entries(bw).map(([ws, { meals: wm, dates }]) => {
        const s = sumMacros(wm), n = dates.length;
        return { key: ws, label: fmtWeek(ws), calories: Math.round(s.calories / n), protein: Math.round(s.protein / n), carbs: Math.round(s.carbs / n), fat: Math.round(s.fat / n), days: n };
      }).sort((a, b) => b.key.localeCompare(a.key));
    }
    const bm: Record<string, { meals: Meal[]; dates: string[] }> = {};
    Object.entries(byDate).forEach(([date, ms]) => {
      const mk = date.slice(0, 7);
      bm[mk] = bm[mk] || { meals: [], dates: [] };
      bm[mk].meals.push(...ms); bm[mk].dates.push(date);
    });
    return Object.entries(bm).map(([mk, { meals: mm, dates }]) => {
      const s = sumMacros(mm), n = dates.length;
      return { key: mk, label: fmtMonth(dates[0]), calories: Math.round(s.calories / n), protein: Math.round(s.protein / n), carbs: Math.round(s.carbs / n), fat: Math.round(s.fat / n), days: n };
    }).sort((a, b) => b.key.localeCompare(a.key));
  }, [meals, period]);
  const isAvg = period !== "day";
  const avg = rows.length > 1 ? {
    calories: Math.round(rows.reduce((a, r) => a + r.calories, 0) / rows.length),
    protein:  Math.round(rows.reduce((a, r) => a + r.protein,  0) / rows.length),
    carbs:    Math.round(rows.reduce((a, r) => a + r.carbs,    0) / rows.length),
    fat:      Math.round(rows.reduce((a, r) => a + r.fat,      0) / rows.length),
  } : null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-700">
        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="px-3 py-1 text-xs rounded-lg capitalize transition-colors"
              style={{ background: period === p ? "#f3f4f6" : "transparent", fontWeight: period === p ? 600 : 400 }}>{p}</button>
          ))}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-base">✕</button>
      </div>
      <div className="overflow-y-auto max-h-72">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-zinc-800">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500">{period === "day" ? "Date" : period === "week" ? "Week" : "Month"}</th>
              {[["Cal","kcal","var(--cal)"],["Prot","g","var(--prot)"],["Carbs","g","var(--carb)"],["Fat","g","var(--fat)"]].map(([l,u,c]) => (
                <th key={l} className="text-right px-2 py-2 font-medium" style={{ color: c }}>{l} <span className="text-gray-400">({u})</span></th>
              ))}
              {isAvg && <th className="text-right px-2 py-2 font-medium text-gray-400">Days</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key} className={i % 2 === 0 ? "" : "bg-gray-50 dark:bg-zinc-800/50"}>
                <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{row.label}</td>
                <td className="px-2 py-2 text-right font-medium" style={{ color: "var(--cal)" }}>{row.calories}</td>
                <td className="px-2 py-2 text-right font-medium" style={{ color: "var(--prot)" }}>{row.protein}</td>
                <td className="px-2 py-2 text-right" style={{ color: "var(--carb)" }}>{row.carbs}</td>
                <td className="px-2 py-2 text-right" style={{ color: "var(--fat)" }}>{row.fat}</td>
                {isAvg && <td className="px-2 py-2 text-right text-gray-400">{row.days}</td>}
              </tr>
            ))}
          </tbody>
          {avg && (
            <tfoot className="bg-gray-50 dark:bg-zinc-800 font-medium">
              <tr>
                <td className="px-4 py-2 text-xs text-gray-500">Avg</td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--cal)" }}>{avg.calories}</td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--prot)" }}>{avg.protein}</td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--carb)" }}>{avg.carbs}</td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--fat)" }}>{avg.fat}</td>
                {isAvg && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── FoodSearch ────────────────────────────────────────────────────────────────
function FoodSearch({ meals, onRelog }: { meals: Meal[]; onRelog: (m: Meal) => void }) {
  const [q, setQ] = useState("");
  const unique = useMemo(() => {
    const sorted = [...meals].sort((a, b) => b.meal_date.localeCompare(a.meal_date));
    const names = new Set<string>();
    return sorted.filter(m => {
      const key = m.name.toLowerCase();
      if (names.has(key)) return false;
      names.add(key); return true;
    });
  }, [meals]);
  const filtered = q.trim() ? unique.filter(m => m.name.toLowerCase().includes(q.toLowerCase())) : unique.slice(0, 8);
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search previously logged foods…"
        className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 mb-2" />
      {filtered.length > 0 && (
        <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          {filtered.map((m, i) => (
            <button key={m.id} onClick={() => onRelog(m)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800 text-left transition-colors"
              style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-gray-400">P: {m.protein}g · C: {m.carbs}g · F: {m.fat}g</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium" style={{ color: "var(--cal)" }}>{m.calories} kcal</span>
                <span className="text-xs text-blue-500 font-medium">+ Add</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MealRow (lightweight) ─────────────────────────────────────────────────────
function MealRow({ meal: m, onDelete, onDateChange }: {
  meal: Meal; onDelete: (id: string) => void;
  onDateChange: (id: string, newDate: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = todayISO();
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 mb-1.5">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{m.name}</p>
        </div>
        <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--prot)" }}>{m.protein}g P</span>
        <span className="text-sm font-medium flex-shrink-0 ml-2" style={{ color: "var(--cal)" }}>{m.calories}</span>
        <button onClick={e => { e.stopPropagation(); onDelete(m.id); }} className="text-gray-300 hover:text-gray-500 text-sm flex-shrink-0 ml-1">✕</button>
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
          <p className="text-xs text-gray-400 mb-2">C: {m.carbs}g · F: {m.fat}g{m.serving_size ? ` · ${m.serving_size}` : ""}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 flex-1">{fmtShort(m.meal_date)}</span>
            <button onClick={() => onDateChange(m.id, offsetDate(m.meal_date, -1))}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:bg-gray-200">← Day</button>
            <button onClick={() => onDateChange(m.id, offsetDate(m.meal_date, 1))}
              disabled={m.meal_date >= today}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-500 hover:bg-gray-200 disabled:opacity-30">Day →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DayGroup (collapsible history day) ───────────────────────────────────────
function DayGroup({ date, dayMeals, dt, onDelete, onDateChange }: {
  date: string; dayMeals: Meal[];
  dt: { calories: number; protein: number; carbs: number; fat: number };
  onDelete: (id: string) => void;
  onDateChange: (id: string, newDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center py-2 px-3 bg-gray-50 dark:bg-zinc-800 rounded-xl">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{fmtShort(date)}</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-400">
            <span className="font-medium" style={{ color: "var(--cal)" }}>{dt.calories}</span> kcal ·{" "}
            P: <span style={{ color: "var(--prot)" }}>{dt.protein}g</span>
          </p>
          <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="mt-1 pl-1">
          {dayMeals.map(m => <MealRow key={m.id} meal={m} onDelete={onDelete} onDateChange={onDateChange} />)}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrackerPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.userId as string;

  const [profile, setProfile]         = useState<Profile | null>(null);
  const [meals, setMeals]             = useState<Meal[]>([]);
  const [mealsReady, setMealsReady]   = useState(false);
  const [ready, setReady]             = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [daysLoaded, setDaysLoaded]   = useState(14);
  const [inputMode, setInputMode]     = useState<"text" | "meal" | "label">("text");
  const [textInput, setTextInput]     = useState("");
  const [preview, setPreview]         = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [clarification, setClar]      = useState<{ question: string; options: string[] } | null>(null);
  const [pendingB64, setPendingB64]   = useState<string | null>(null);
  const [pendingMime, setPendingMime] = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState("");
  const [error, setError]             = useState("");
  const [showTable, setShowTable]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chartView, setChartView]     = useState<"day" | "week">("day");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Step 1: load profiles first — show UI immediately
    getProfiles().then(profs => {
      const p = profs.find(x => x.id === userId);
      if (!p) { router.push("/"); return; }
      setProfile(p);
      setReady(true);
      // Step 2: load meals in background after UI is shown
      getMeals(userId).then(ms => {
        setMeals(ms);
        setMealsReady(true);
      });
    });
  }, [userId, router]);

  const loadMoreMeals = async () => {
    setLoadingMore(true);
    const moreDays = daysLoaded + 30;
    const ms = await getMealsSince(userId, moreDays);
    setMeals(ms);
    setDaysLoaded(moreDays);
    setLoadingMore(false);
  };

  const today = todayISO();
  const todayMeals = meals.filter(m => m.meal_date === today);
  const totals = sumMacros(todayMeals);

  const last7 = useMemo(() => {
    const byDate: Record<string, Meal[]> = {};
    meals.forEach(m => { byDate[m.meal_date] = byDate[m.meal_date] || []; byDate[m.meal_date].push(m); });
    return getLast7Days().map(date => {
      const s = sumMacros(byDate[date] || []);
      return { date, calValue: s.calories, protValue: s.protein };
    });
  }, [meals]);

  const handleAddMeal = useCallback(async (
    result: Omit<Meal, "id" | "logged_at" | "profile_id">, imgUrl?: string
  ) => {
    const saved = await addMeal({
      ...result, profile_id: userId,
      image_url: imgUrl ?? null,
      meal_date: result.meal_date ?? today,
    } as Omit<Meal, "id" | "logged_at">);
    setMeals(prev => [saved, ...prev]);
    setPreview(null); setPendingFile(null); setTextInput("");
    setClar(null); setPendingB64(null); setPendingMime(null);
  }, [userId, today]);

  const handleDeleteMeal = useCallback(async (id: string) => {
    await deleteMeal(id);
    setMeals(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleDateChange = useCallback(async (id: string, newDate: string) => {
    await updateMeal(id, { meal_date: newDate });
    setMeals(prev => prev.map(m => m.id === id ? { ...m, meal_date: newDate } : m));
  }, []);

  const handleRelog = useCallback((m: Meal) => {
    handleAddMeal({
      name: m.name, calories: m.calories, protein: m.protein,
      carbs: m.carbs, fat: m.fat, source: m.source,
      confidence: m.confidence, notes: "Relogged", serving_size: m.serving_size,
      meal_date: todayISO(),
    });
  }, [handleAddMeal]);

  const handleFile = (file: File) => {
    const r = new FileReader();
    r.onload = e => { setPreview(e.target!.result as string); setPendingFile(file); };
    r.readAsDataURL(file);
  };

  const resetAdd = () => {
    setPreview(null); setPendingFile(null);
    setClar(null); setError(""); setTextInput("");
  };

  const startAnalysis = async () => {
    setLoading(true); setError(""); setClar(null);
    try {
      let b64: string | null = null, mime: string | null = null;
      if (pendingFile) {
        const r = await readFileAsBase64(pendingFile);
        b64 = r.base64; mime = r.mimeType;
        setPendingB64(b64); setPendingMime(mime);
      }
      setLoadingMsg("Reviewing…");
      const check = await fetch("/api/followup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: inputMode, text: textInput, base64: b64, mimeType: mime }),
      }).then(r => r.json());
      if (check.needsClarification) {
        setClar({ question: check.question, options: check.options });
        setLoading(false);
      } else {
        await runFinal(textInput, inputMode, null, b64, mime);
      }
    } catch(e) { setError(e instanceof Error ? e.message : "Something went wrong."); setLoading(false); }
  };

  const runFinal = async (
    text: string, mode: string, clar: string | null,
    b64: string | null, mime: string | null
  ) => {
    setLoading(true);
    setLoadingMsg(mode === "label" ? "Reading label…" : mode === "text" ? "Searching & estimating…" : "Analyzing photo…");
    try {
      const result = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, text, base64: b64, mimeType: mime, clarification: clar }),
      }).then(r => r.json());
      if (result.error) { setError(result.error); setLoading(false); return; }
      await handleAddMeal(result, preview ?? undefined);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not estimate. Try again."); }
    finally { setLoading(false); }
  };

  const canSubmit = pendingFile || textInput.trim().length > 0;

  const historyGrouped = meals
    .filter(m => m.meal_date !== today)
    .reduce<Record<string, Meal[]>>((acc, m) => {
      acc[m.meal_date] = acc[m.meal_date] || []; acc[m.meal_date].push(m); return acc;
    }, {});

  // Show skeleton while profile loads
  if (!ready) return (
    <div className="max-w-md mx-auto px-4 pb-16 pt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-6 w-36 bg-gray-200 dark:bg-zinc-700 rounded animate-pulse mb-1" />
          <div className="h-3 w-28 bg-gray-100 dark:bg-zinc-800 rounded animate-pulse" />
        </div>
        <div className="w-24 h-9 bg-gray-200 dark:bg-zinc-700 rounded-full animate-pulse" />
      </div>
      <div className="h-32 bg-gray-100 dark:bg-zinc-800 rounded-2xl animate-pulse mb-4" />
      <div className="h-48 bg-gray-100 dark:bg-zinc-800 rounded-2xl animate-pulse mb-4" />
    </div>
  );

  const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="max-w-md mx-auto px-4 pb-16 pt-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-medium">Calorie tracker</h1>
          <p className="text-xs text-gray-400 mt-0.5">{todayStr}</p>
        </div>
        <button onClick={() => router.push("/")}
          className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-full px-3 py-1.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-base"
            style={{ background: profile!.avatar_bg }}>{profile!.avatar}</div>
          <span className="text-sm font-medium">{profile!.name}</span>
        </button>
      </div>

      {/* Daily summary */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4 flex items-center gap-4">
        <CalorieRing eaten={totals.calories} goal={DAILY_GOAL} />
        <div className="flex-1">
          <div className="grid grid-cols-3 gap-2 mb-2">
            {([
              ["Protein", totals.protein,  "g", "var(--prot)"],
              ["Carbs",   totals.carbs,    "g", "var(--carb)"],
              ["Fat",     totals.fat,      "g", "var(--fat)"],
            ] as [string, number, string, string][]).map(([l, v, u, c]) => (
              <div key={l} className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-2 text-center">
                <p className="text-xs text-gray-400">{l}</p>
                <p className="text-sm font-medium" style={{ color: c }}>
                  {v}<span className="text-xs font-normal text-gray-400">{u}</span>
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center">
            {Math.max(0, DAILY_GOAL - totals.calories)} kcal remaining
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4 space-y-4">
        <div className="flex justify-end gap-1">
          {(["day", "week"] as const).map(v => (
            <button key={v} onClick={() => setChartView(v)}
              className="px-3 py-1 text-xs rounded-lg capitalize transition-colors"
              style={{ background: chartView === v ? "#f3f4f6" : "transparent", fontWeight: chartView === v ? 600 : 400, color: chartView === v ? "#111" : "#9ca3af" }}>
              {v === "day" ? "Daily" : "7-day avg"}
            </button>
          ))}
        </div>
        {!mealsReady ? (
          <div className="h-24 bg-gray-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
        ) : (
          <>
            <MiniChart data={last7.map(d => ({ date: d.date, value: d.calValue }))}
              color="#7F77DD" goal={DAILY_GOAL} label="Calories — last 7 days" unit="kcal"
              onBarClick={() => setShowTable(t => !t)} viewMode={chartView} />
            <MiniChart data={last7.map(d => ({ date: d.date, value: d.protValue }))}
              color="#1D9E75" goal={PROTEIN_GOAL} label="Protein — last 7 days" unit="g"
              onBarClick={() => setShowTable(t => !t)} viewMode={chartView} />
          </>
        )}
        <p className="text-xs text-center text-blue-400 cursor-pointer" onClick={() => setShowTable(t => !t)}>
          {showTable ? "▲ Hide table" : "▼ Tap a bar or here for full history"}
        </p>
      </div>

      {showTable && <AnalyticsTable meals={meals} onClose={() => setShowTable(false)} />}

      {/* Add new meal */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
        <p className="text-xs font-medium text-gray-400 mb-3">Add new meal</p>
        <div className="flex gap-2 mb-4">
          {([
            ["meal",  "🍽️", "Meal photo"],
            ["label", "🏷️", "Nutrition label"],
            ["text",  "✏️", "Describe it"],
          ] as [typeof inputMode, string, string][]).map(([key, icon, lbl]) => (
            <button key={key} onClick={() => { setInputMode(key); resetAdd(); }}
              className="flex-1 py-2 px-1 text-xs rounded-xl border transition-colors"
              style={{
                background: inputMode === key ? "#f3f4f6" : "transparent",
                fontWeight: inputMode === key ? 600 : 400,
                borderColor: inputMode === key ? "#d1d5db" : "#e5e7eb",
                color: inputMode === key ? "#111" : "#9ca3af",
              }}>
              <div className="text-base mb-0.5">{icon}</div>{lbl}
            </button>
          ))}
        </div>

        {clarification && !loading && (
          <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
            <p className="text-sm font-medium mb-2">One quick question:</p>
            <p className="text-sm mb-3">{clarification.question}</p>
            <div className="space-y-2">
              {clarification.options.map(opt => (
                <button key={opt} onClick={() => runFinal(textInput, inputMode, opt, pendingB64, pendingMime)}
                  className="w-full text-left text-sm px-4 py-2.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-600 rounded-xl hover:bg-gray-50">
                  {opt}
                </button>
              ))}
              <button onClick={() => runFinal(textInput, inputMode, "Not sure, best estimate", pendingB64, pendingMime)}
                className="w-full text-left text-xs px-4 py-2 text-gray-400 hover:text-gray-600">
                Not sure — just estimate
              </button>
            </div>
          </div>
        )}

        {!clarification && (
          <div className="space-y-3">
            {inputMode !== "text" && (
              !preview ? (
                <div onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}
                  className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl p-6 text-center">
                  <div className="text-4xl mb-2">{inputMode === "label" ? "🏷️" : "🍽️"}</div>
                  <p className="text-sm font-medium mb-3">{inputMode === "label" ? "Scan nutrition label" : "Upload meal photo"}</p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => { if (fileRef.current) { fileRef.current.removeAttribute("capture"); fileRef.current.click(); } }}
                      className="px-4 py-2 text-xs bg-gray-100 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-600 font-medium">
                      📁 Gallery
                    </button>
                    <button onClick={() => { if (fileRef.current) { fileRef.current.setAttribute("capture", "environment"); fileRef.current.click(); } }}
                      className="px-4 py-2 text-xs bg-gray-100 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-600 font-medium">
                      📷 Camera
                    </button>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => e.target.files && handleFile(e.target.files[0])} />
                </div>
              ) : (
                <div className="relative">
                  <img src={preview} alt="preview" className="w-full rounded-2xl max-h-52 object-cover" />
                  <button onClick={() => { setPreview(null); setPendingFile(null); }}
                    className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm">✕</button>
                </div>
              )
            )}
            {inputMode === "text" && (
              <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                placeholder="e.g. 'Two scrambled eggs with toast' or 'McDonald's Big Mac meal'" rows={3}
                className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
            )}
            {inputMode !== "text" && (
              <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                placeholder={inputMode === "label" ? "Optional: add notes (e.g. '2 servings')" : "Optional: describe the meal for better accuracy"}
                rows={2}
                className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
            )}
            <div className="flex gap-2">
              {(preview || textInput.trim()) && (
                <button onClick={resetAdd}
                  className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">
                  Cancel
                </button>
              )}
              <button onClick={startAnalysis} disabled={loading || !canSubmit}
                className="flex-[2] bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
                {loading ? loadingMsg : inputMode === "label" ? "Read label" : inputMode === "meal" ? "Analyze photo" : "Search & estimate"}
              </button>
            </div>
          </div>
        )}
        {loading && <p className="text-center text-sm text-gray-400 mt-3">⏳ {loadingMsg}</p>}
        {error   && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Recent foods */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
        <p className="text-xs font-medium text-gray-400 mb-3">Recent foods</p>
        <FoodSearch meals={meals} onRelog={handleRelog} />
      </div>

      {/* Today's meals */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Today</p>
        {!mealsReady ? (
          <div className="h-12 bg-gray-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
        ) : todayMeals.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No meals logged today.</p>
        ) : (
          todayMeals.map(m => <MealRow key={m.id} meal={m} onDelete={handleDeleteMeal} onDateChange={handleDateChange} />)
        )}
      </div>

      {/* History */}
      <div>
        <button onClick={() => setShowHistory(h => !h)}
          className="w-full flex justify-between items-center py-2 px-3 bg-gray-50 dark:bg-zinc-800 rounded-xl mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</p>
          <span className="text-gray-400 text-xs">{showHistory ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {showHistory && (
          <div>
            {Object.keys(historyGrouped).length === 0
              ? <p className="text-sm text-gray-400 text-center py-4">No history yet.</p>
              : Object.entries(historyGrouped).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dayMeals]) => (
                  <DayGroup key={date} date={date} dayMeals={dayMeals}
                    dt={sumMacros(dayMeals)}
                    onDelete={handleDeleteMeal} onDateChange={handleDateChange} />
                ))
            }
            <button onClick={loadMoreMeals} disabled={loadingMore}
              className="w-full mt-2 py-2.5 text-xs text-gray-400 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-gray-50 disabled:opacity-40">
              {loadingMore ? "Loading…" : `Load more (showing last ${daysLoaded} days)`}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}