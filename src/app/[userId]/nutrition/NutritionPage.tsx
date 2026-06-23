"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getProfiles, getMeals30Days, type Meal, type Profile } from "@/lib/db";
import { getLast7Days, sumMacros, fmtShort } from "@/lib/utils";
import BottomNav from "../BottomNav";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ExtendedMacros {
  fiber: number;
  sodium: number;
  vitamin_c: number;
  vitamin_d: number;
  iron: number;
  calcium: number;
}

function sumExtended(meals: Meal[]): ExtendedMacros {
  return meals.reduce((acc, m: any) => ({
    fiber:     acc.fiber     + (m.fiber     ?? 0),
    sodium:    acc.sodium    + (m.sodium    ?? 0),
    vitamin_c: acc.vitamin_c + (m.vitamin_c ?? 0),
    vitamin_d: acc.vitamin_d + (m.vitamin_d ?? 0),
    iron:      acc.iron      + (m.iron      ?? 0),
    calcium:   acc.calcium   + (m.calcium   ?? 0),
  }), { fiber: 0, sodium: 0, vitamin_c: 0, vitamin_d: 0, iron: 0, calcium: 0 });
}

// ── Daily Reference Values (DRV) for progress bars ───────────────────────────
const DRV: Record<keyof ExtendedMacros, { label: string; unit: string; drv: number; color: string; warn?: number }> = {
  fiber:     { label: "Fiber",     unit: "g",   drv: 28,   color: "#22C55E", warn: undefined },
  sodium:    { label: "Sodium",    unit: "mg",  drv: 2300, color: "#F59E0B", warn: 1500 },
  vitamin_c: { label: "Vitamin C", unit: "mg",  drv: 90,   color: "#6366F1", warn: undefined },
  vitamin_d: { label: "Vitamin D", unit: "mcg", drv: 20,   color: "#F97316", warn: undefined },
  iron:      { label: "Iron",      unit: "mg",  drv: 18,   color: "#EF4444", warn: undefined },
  calcium:   { label: "Calcium",   unit: "mg",  drv: 1300, color: "#3B82F6", warn: undefined },
};

// ── MiniBar ───────────────────────────────────────────────────────────────────
function MiniBar({ value, drv, color, warn }: { value: number; drv: number; color: string; warn?: number }) {
  const pct = Math.min((value / drv) * 100, 100);
  const overWarn = warn && value > warn;
  const barColor = overWarn ? "#EF4444" : pct >= 100 ? "#22C55E" : color;
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div className="flex-1 bg-gray-100 dark:bg-zinc-700 rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="text-[10px] text-gray-400 w-6 text-right flex-shrink-0">{Math.round(pct)}%</span>
    </div>
  );
}

// ── MetricCard ────────────────────────────────────────────────────────────────
function MetricCard({
  metricKey, weeklyAvg, dailyData, daysLogged,
}: {
  metricKey: keyof ExtendedMacros;
  weeklyAvg: number;
  dailyData: { date: string; value: number; mealCount: number }[];
  daysLogged: number;
}) {
  const { label, unit, drv, color, warn } = DRV[metricKey];
  const pct = Math.min(Math.round((weeklyAvg / drv) * 100), 999);
  const overWarn = warn && weeklyAvg > warn;
  const status = overWarn
    ? { text: "Above recommended", color: "#EF4444" }
    : pct >= 100
    ? { text: "Goal met", color: "#22C55E" }
    : pct >= 66
    ? { text: "Almost there", color: "#F59E0B" }
    : { text: "Below goal", color: "#6B7280" };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white">{label}</p>
          <p className="text-xs" style={{ color: status.color }}>{status.text}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold" style={{ color }}>
            {weeklyAvg % 1 === 0 ? weeklyAvg : weeklyAvg.toFixed(1)}
            <span className="text-xs font-normal text-gray-400 ml-0.5">{unit}</span>
          </p>
          <p className="text-[10px] text-gray-400">avg / day · goal {drv}{unit}</p>
        </div>
      </div>

      {/* Weekly progress bar */}
      <MiniBar value={weeklyAvg} drv={drv} color={color} warn={warn} />

      {/* Per-day breakdown */}
      <div className="mt-3 space-y-1.5">
        {dailyData.map(({ date, value, mealCount }) => {
          const isFull = mealCount >= 2;
          return (
            <div key={date} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 w-8 flex-shrink-0">
                {new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              {isFull ? (
                <>
                  <MiniBar value={value} drv={drv} color={color} warn={warn} />
                  <span className="text-[10px] text-gray-500 w-12 text-right flex-shrink-0">
                    {value % 1 === 0 ? value : value.toFixed(1)}{unit}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-gray-300 dark:text-zinc-600 flex-1 italic">
                  {mealCount === 0 ? "not logged" : "partial day"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function NutritionPage() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [ready, setReady] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("caloriq-theme") : null;
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    }
  }, []);

  useEffect(() => {
    getProfiles().then(profs => {
      const p = profs.find(x => x.id === userId);
      if (!p) { router.push("/"); return; }
      setProfile(p);
      getMeals30Days(userId).then(ms => {
        setMeals(ms);
        setReady(true);
      }).catch(() => setReady(true));
    }).catch(() => router.push("/"));
  }, [userId, router]);

  const last7 = getLast7Days();

  // Per-day data for each metric
  const dailyData = useMemo(() => {
    return last7.map(date => {
      const dayMeals = meals.filter(m => m.meal_date === date);
      const macros = sumMacros(dayMeals);
      const ext = sumExtended(dayMeals);
      return {
        date,
        mealCount: dayMeals.length,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        ...ext,
      };
    });
  }, [meals, last7]);

  // Full days only (≥2 meals) for averages — consistent with main page
  const fullDays = dailyData.filter(d => d.mealCount >= 2);
  const daysLogged = fullDays.length;

  const weeklyAvg = useMemo(() => {
    if (daysLogged === 0) return { fiber: 0, sodium: 0, vitamin_c: 0, vitamin_d: 0, iron: 0, calcium: 0, calories: 0, protein: 0 };
    const sum = fullDays.reduce((acc, d) => ({
      fiber:     acc.fiber     + d.fiber,
      sodium:    acc.sodium    + d.sodium,
      vitamin_c: acc.vitamin_c + d.vitamin_c,
      vitamin_d: acc.vitamin_d + d.vitamin_d,
      iron:      acc.iron      + d.iron,
      calcium:   acc.calcium   + d.calcium,
      calories:  acc.calories  + d.calories,
      protein:   acc.protein   + d.protein,
    }), { fiber: 0, sodium: 0, vitamin_c: 0, vitamin_d: 0, iron: 0, calcium: 0, calories: 0, protein: 0 });
    return Object.fromEntries(
      Object.entries(sum).map(([k, v]) => [k, Math.round((v / daysLogged) * 10) / 10])
    ) as typeof sum;
  }, [fullDays, daysLogged]);

  // Check if any extended data has been logged at all
  const hasExtendedData = fullDays.some(d => d.fiber > 0 || d.sodium > 0 || d.vitamin_c > 0);

  if (!ready) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="h-6 w-40 bg-gray-200 dark:bg-zinc-700 rounded animate-pulse mb-6" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-40 bg-gray-100 dark:bg-zinc-800 rounded-2xl animate-pulse mb-4" />
        ))}
      </div>
    );
  }

  return (
    <>
    <div className="max-w-md mx-auto px-4 pt-4" style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/${userId}?tab=today`)}
          className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0">
          ←
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Nutrition Details</h1>
          <p className="text-xs text-gray-400">
            {daysLogged > 0
              ? `Based on ${daysLogged} fully logged day${daysLogged !== 1 ? "s" : ""} this week`
              : "No fully logged days this week yet"}
          </p>
        </div>
      </div>

      {daysLogged === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-sm font-medium mb-1">Nothing to show yet</p>
          <p className="text-xs text-gray-300">Log at least 2 meals on a day to see your nutrition breakdown.</p>
          <button onClick={() => router.push(`/${userId}?tab=add`)}
            className="mt-4 text-xs text-indigo-500 hover:text-indigo-600">← Back to logging</button>
        </div>
      ) : (
        <>
          {/* Weekly summary strip */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Weekly averages · {daysLogged}/7 full days</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Calories", weeklyAvg.calories, "kcal", "var(--cal)"],
                ["Protein",  weeklyAvg.protein,  "g",    "var(--prot)"],
              ] as [string, number, string, string][]).map(([label, val, unit, color]) => (
                <div key={label} className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="text-base font-bold" style={{ color }}>
                    {Math.round(val)}<span className="text-xs font-normal text-gray-400 ml-0.5">{unit}</span>
                  </p>
                  <p className="text-[10px] text-gray-400">avg / day</p>
                </div>
              ))}
            </div>
          </div>

          {!hasExtendedData && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 mb-5">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">⚠️ Extended data not available yet</p>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Fiber, sodium, and vitamin data is collected from meals logged going forward. Older meal entries don't have this data.
              </p>
            </div>
          )}

          {/* Extended metric cards */}
          <div className="space-y-4">
            {(Object.keys(DRV) as (keyof ExtendedMacros)[]).map(key => (
              <MetricCard
                key={key}
                metricKey={key}
                weeklyAvg={weeklyAvg[key]}
                daysLogged={daysLogged}
                dailyData={dailyData.map(d => ({ date: d.date, value: d[key], mealCount: d.mealCount }))}
              />
            ))}
          </div>

          {/* DRV note */}
          <p className="text-[10px] text-gray-300 dark:text-zinc-600 text-center mt-6 px-4">
            Daily Reference Values based on a 2,000 kcal diet. Sodium warning threshold: 1,500 mg. Averages calculated from fully logged days only (≥2 meals).
          </p>
        </>
      )}
    </div>

    <BottomNav active="stats" />
    </>
  );
}