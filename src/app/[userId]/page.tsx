"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  getProfiles, getMeals, addMeal, deleteMeal, updateMeal,
  type Profile, type Meal, type MealType,
} from "@/lib/db";
import {
  sumMacros, todayISO, getLast7Days,
  fmtShort, fmtWeek, fmtMonth, getWeekStart,
  DAILY_GOAL, PROTEIN_GOAL,
} from "@/lib/utils";

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

function floorTo30(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  out.setMinutes(d.getMinutes() < 30 ? 0 : 30);
  return out;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shiftMinutes(d: Date, delta: number): Date {
  return new Date(d.getTime() + delta * 60_000);
}

function suggestMealType(d: Date): MealType {
  const h = d.getHours();
  if (h < 10) return "breakfast";
  if (h < 13) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

const MEAL_TYPES: { key: MealType; label: string; emoji: string }[] = [
  { key: "breakfast", label: "Breakfast", emoji: "🌅" },
  { key: "lunch",     label: "Lunch",     emoji: "☀️" },
  { key: "snack",     label: "Snack",     emoji: "🍎" },
  { key: "dinner",    label: "Dinner",    emoji: "🌙" },
];

const MEAL_TYPE_COLORS: Record<MealType, string> = {
  breakfast: "#F59E0B",
  lunch:     "#10B981",
  snack:     "#8B5CF6",
  dinner:    "#3B82F6",
};

// ── CalorieRing ───────────────────────────────────────────────────────────────
function CalorieRing({ eaten, goal }: { eaten: number; goal: number }) {
  const pct = Math.min(eaten / goal, 1), r = 48, cx = 56, cy = 56, circ = 2 * Math.PI * r;
  const color = pct > 1 ? "#E24B4A" : pct > 0.85 ? "#F59E0B" : "#22C55E";
  return (
    <svg width={112} height={112}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={10} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={16} fontWeight={700} fill={color}>{eaten}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={10} fill="#9ca3af">/ {goal}</text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize={9} fill="#9ca3af">kcal</text>
    </svg>
  );
}

// ── MealTimeEditor ────────────────────────────────────────────────────────────
function MealTimeEditor({
  mealTime, mealType, onChange, onTypeChange,
}: {
  mealTime: Date; mealType: MealType;
  onChange: (d: Date) => void; onTypeChange: (t: MealType) => void;
}) {
  return (
    <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-3 mb-3">
      <p className="text-xs font-medium text-gray-400 mb-2">Meal type</p>
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {MEAL_TYPES.map(({ key, label, emoji }) => {
          const active = mealType === key;
          return (
            <button key={key} onClick={() => onTypeChange(key)}
              className="flex flex-col items-center py-2 rounded-xl border text-xs transition-all"
              style={{
                background: active ? MEAL_TYPE_COLORS[key] + "18" : "transparent",
                borderColor: active ? MEAL_TYPE_COLORS[key] : "#e5e7eb",
                color: active ? MEAL_TYPE_COLORS[key] : "#9ca3af",
                fontWeight: active ? 600 : 400,
              }}>
              <span className="text-base mb-0.5">{emoji}</span>{label}
            </button>
          );
        })}
      </div>
      <p className="text-xs font-medium text-gray-400 mb-2">Meal time</p>
      <div className="flex items-center justify-between bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2">
        <button onClick={() => onChange(shiftMinutes(mealTime, -30))}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 text-lg font-light">−</button>
        <span className="text-sm font-semibold tabular-nums">{fmtTime(mealTime)}</span>
        <button onClick={() => onChange(shiftMinutes(mealTime, 30))}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 text-lg font-light">+</button>
      </div>
    </div>
  );
}

// ── BarChart ──────────────────────────────────────────────────────────────────
type ChartType = "calories" | "protein";
function BarChart({ meals, type, onBarClick }: { meals: Meal[]; type: ChartType; onBarClick: () => void }) {
  const [showAvg, setShowAvg] = useState(false);
  const days = getLast7Days();
  const goal = type === "calories" ? DAILY_GOAL : PROTEIN_GOAL;
  const color = type === "calories" ? "var(--cal)" : "var(--prot)";
  const data = days.map(date => {
    const dayMeals = meals.filter(m => m.meal_date === date);
    return { date, value: sumMacros(dayMeals)[type] };
  });
  const avg = Math.round(data.reduce((s, d) => s + d.value, 0) / (data.filter(d => d.value > 0).length || 1));
  const displayGoal = showAvg ? avg : goal;
  const maxVal = Math.max(...data.map(d => d.value), displayGoal);
  const today = todayISO();
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {type === "calories" ? "Calories" : "Protein"} — last 7 days
        </p>
        <button onClick={() => setShowAvg(p => !p)}
          className="text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-zinc-600 text-gray-400 hover:text-gray-600">
          {showAvg ? "vs goal" : "vs avg"}
        </button>
      </div>
      <div className="flex gap-1 items-end h-28 cursor-pointer" onClick={onBarClick}>
        {data.map((d) => {
          const isToday = d.date === today;
          const barH = maxVal > 0 ? Math.round((d.value / maxVal) * 96) : 0;
          const goalH = Math.round((displayGoal / maxVal) * 96);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end relative" style={{ height: 96 }}>
              <div className="absolute w-full" style={{ bottom: goalH, borderTop: `1.5px dashed ${color}`, opacity: 0.4 }} />
              {d.value > 0 && (
                <span className="text-[9px] font-semibold absolute" style={{ bottom: barH + 2, color, left: "50%", transform: "translateX(-50%)" }}>
                  {d.value}
                </span>
              )}
              <div className="w-full rounded-t-md"
                style={{ height: barH, background: color, opacity: isToday ? 1 : 0.5, border: isToday ? `1.5px solid ${color}` : "none" }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center"
            style={{ fontSize: 9, color: i === 6 ? "#374151" : "#9ca3af", fontWeight: i === 6 ? 600 : 400 }}>
            {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "narrow" })}
          </div>
        ))}
      </div>
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
  const avg = rows.length > 1
    ? { calories: Math.round(rows.reduce((s, r) => s + r.calories, 0) / rows.length), protein: Math.round(rows.reduce((s, r) => s + r.protein, 0) / rows.length), carbs: Math.round(rows.reduce((s, r) => s + r.carbs, 0) / rows.length), fat: Math.round(rows.reduce((s, r) => s + r.fat, 0) / rows.length) }
    : null;
  return (
    <div className="mt-4 border border-gray-200 dark:border-zinc-700 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-700">
        <div className="flex gap-1">
          {(["day", "week", "month"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="text-xs px-3 py-1 rounded-full transition-colors capitalize"
              style={{ background: period === p ? "#f3f4f6" : "transparent", fontWeight: period === p ? 600 : 400, color: period === p ? "#111" : "#9ca3af" }}>
              {p}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">✕</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-zinc-700">
              <th className="px-4 py-2 text-left font-medium">Period</th>
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--cal)" }}>kcal</th>
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--prot)" }}>P</th>
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--carb)" }}>C</th>
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--fat)" }}>F</th>
              {isAvg && <th className="px-2 py-2 text-right font-medium text-gray-300">days</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key} className={i % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-gray-50 dark:bg-zinc-800/50"}>
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
    const seen = new Map<string, Meal>();
    [...meals].sort((a, b) => b.meal_date.localeCompare(a.meal_date))
      .forEach(m => { if (!seen.has(m.name.toLowerCase())) seen.set(m.name.toLowerCase(), m); });
    return Array.from(seen.values());
  }, [meals]);
  const filtered = q.trim() ? unique.filter(m => m.name.toLowerCase().includes(q.toLowerCase())) : unique.slice(0, 8);
  return (
    <div className="mb-4">
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

// ── MealCard ──────────────────────────────────────────────────────────────────
function MealCard({ meal: m, onDelete, onUpdate }: {
  meal: Meal;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Meal>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState(m.notes ?? "");
  const [editType, setEditType] = useState<MealType>(m.meal_type);
  const [editTime, setEditTime] = useState<Date>(() => new Date(m.meal_time || m.logged_at));
  const [saving, setSaving] = useState(false);

  const time = new Date(m.meal_time || m.logged_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const typeInfo = MEAL_TYPES.find(t => t.key === m.meal_type);

  const handleSave = async () => {
    setSaving(true);
    try {
      const notesChanged = editNotes !== (m.notes ?? "");

      if (notesChanged) {
        // Re-run AI analysis with updated notes as extra context
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "text",
            text: `${m.name}. Additional details: ${editNotes}`,
            base64: null,
            mimeType: null,
            clarification: null,
          }),
        }).then(r => r.json());

        if (!res.error) {
          onUpdate(m.id, {
            calories: res.calories,
            protein: res.protein,
            carbs: res.carbs,
            fat: res.fat,
            serving_size: res.serving_size ?? m.serving_size,
            notes: editNotes,
            meal_type: editType,
            meal_time: editTime.toISOString(),
          });
        } else {
          // AI failed — save everything except macros
          onUpdate(m.id, {
            notes: editNotes,
            meal_type: editType,
            meal_time: editTime.toISOString(),
          });
        }
      } else {
        // Just save type and time
        onUpdate(m.id, {
          meal_type: editType,
          meal_time: editTime.toISOString(),
        });
      }
      setEditing(false);
    } catch {
      onUpdate(m.id, {
        notes: editNotes,
        meal_type: editType,
        meal_time: editTime.toISOString(),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-3 mb-2">
      {/* Main row */}
      <div className="flex items-center gap-3">
        {m.image_url ? (
          <img src={m.image_url} alt={m.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 bg-gray-50 dark:bg-zinc-800">
            {typeInfo?.emoji ?? "🍽️"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{m.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {typeInfo && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-md"
                style={{ background: MEAL_TYPE_COLORS[m.meal_type] + "18", color: MEAL_TYPE_COLORS[m.meal_type] }}>
                {typeInfo.label}
              </span>
            )}
            <p className="text-xs text-gray-400">{time} · P: {m.protein}g</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <p className="text-sm font-semibold" style={{ color: "var(--cal)" }}>{m.calories} kcal</p>
          <div className="flex gap-2">
            <button onClick={() => setEditing(e => !e)} className="text-xs text-gray-300 hover:text-blue-400 transition-colors">✏️</button>
            <button onClick={() => onDelete(m.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">✕</button>
          </div>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-3">
          {/* Meal type */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Meal type</p>
            <div className="grid grid-cols-4 gap-1.5">
              {MEAL_TYPES.map(({ key, label, emoji }) => {
                const active = editType === key;
                return (
                  <button key={key} onClick={() => setEditType(key)}
                    className="flex flex-col items-center py-1.5 rounded-xl border text-xs transition-all"
                    style={{
                      background: active ? MEAL_TYPE_COLORS[key] + "18" : "transparent",
                      borderColor: active ? MEAL_TYPE_COLORS[key] : "#e5e7eb",
                      color: active ? MEAL_TYPE_COLORS[key] : "#9ca3af",
                      fontWeight: active ? 600 : 400,
                    }}>
                    <span className="text-sm mb-0.5">{emoji}</span>{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Meal time</p>
            <div className="flex items-center justify-between bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2">
              <button onClick={() => setEditTime(d => new Date(d.getTime() - 30 * 60000))}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 text-lg font-light">−</button>
              <span className="text-sm font-semibold tabular-nums">
                {editTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <button onClick={() => setEditTime(d => new Date(d.getTime() + 30 * 60000))}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 text-lg font-light">+</button>
            </div>
          </div>

          {/* Notes / description */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Notes / description</p>
            <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
              placeholder="Add details to improve identification (e.g. 'grilled, no sauce, large portion')"
              rows={2}
              className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
          </div>

          {/* Save / cancel */}
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)}
              className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm text-gray-400">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-[2] bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm font-medium disabled:opacity-40">
              {saving
                ? editNotes !== (m.notes ?? "") ? "Re-analyzing…" : "Saving…"
                : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DayLoggedButton ───────────────────────────────────────────────────────────
function DayLoggedButton({ confirmed, onToggle }: { confirmed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 transition-all mt-4"
      style={{
        borderColor: confirmed ? "#22C55E" : "#e5e7eb",
        background: confirmed ? "#22C55E14" : "transparent",
        color: confirmed ? "#22C55E" : "#9ca3af",
      }}>
      <span className="text-lg">{confirmed ? "✅" : "☑️"}</span>
      <span className="text-sm font-semibold">
        {confirmed ? "Day logged — all meals recorded!" : "Confirm I've logged everything today"}
      </span>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TrackerPage() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [ready, setReady] = useState(false);

  const [tab, setTab] = useState<"today" | "history" | "add">("today");
  const [inputMode, setInputMode] = useState<"meal" | "label" | "text">("text");
  const [textInput, setTextInput] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Analyzing…");
  const [error, setError] = useState("");
  const [clarification, setClar] = useState<{ question: string; options: string[] } | null>(null);
  const [pendingB64, setPendingB64] = useState<string | null>(null);
  const [pendingMime, setPendingMime] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("calories");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [pendingMealTime, setPendingMealTime] = useState<Date>(() => floorTo30(new Date()));
  const [pendingMealType, setPendingMealType] = useState<MealType>(() => suggestMealType(new Date()));
  const [dayConfirmed, setDayConfirmed] = useState(false);
  const today = todayISO();

  useEffect(() => {
    const stored = localStorage.getItem(`dayConfirmed:${userId}`);
    if (stored === today) setDayConfirmed(true);
  }, [userId, today]);

  const toggleDayConfirmed = () => {
    const next = !dayConfirmed;
    setDayConfirmed(next);
    if (next) localStorage.setItem(`dayConfirmed:${userId}`, today);
    else localStorage.removeItem(`dayConfirmed:${userId}`);
  };

  useEffect(() => {
    getProfiles().then(profs => {
      const p = profs.find(x => x.id === userId);
      if (!p) { router.push("/"); return; }
      setProfile(p);
      setReady(true);
      getMeals(userId).then(ms => setMeals(ms)).catch(() => {});
    }).catch(() => router.push("/"));
  }, [userId, router]);

  useEffect(() => {
    if (tab === "add") {
      const now = new Date();
      setPendingMealTime(floorTo30(now));
      setPendingMealType(suggestMealType(now));
    }
  }, [tab]);

  const todayMeals = useMemo(() => meals.filter(m => m.meal_date === today), [meals, today]);
  const totals = useMemo(() => sumMacros(todayMeals), [todayMeals]);

  const handleAddMeal = useCallback(async (
    result: Omit<Meal, "id" | "logged_at" | "profile_id" | "image_url" | "meal_date" | "meal_type" | "meal_time">,
    imgUrl?: string, mealType?: MealType, mealTime?: Date,
  ) => {
    const saved = await addMeal({
      ...result, profile_id: userId,
      image_url: imgUrl ?? null,
      meal_date: today,
      meal_type: mealType ?? pendingMealType,
      meal_time: (mealTime ?? pendingMealTime).toISOString(),
    });
    setMeals(prev => [saved, ...prev]);
    setPreview(null); setPendingFile(null); setTextInput("");
    setClar(null); setPendingB64(null); setPendingMime(null);
    setTab("today");
  }, [userId, today, pendingMealType, pendingMealTime]);

  const handleDeleteMeal = useCallback(async (id: string) => {
    await deleteMeal(id);
    setMeals(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleUpdateMeal = useCallback(async (id: string, updates: Partial<Meal>) => {
    const updated = await updateMeal(id, updates);
    setMeals(prev => prev.map(m => m.id === id ? updated : m));
  }, []);

  const handleRelog = useCallback((m: Meal) => {
    handleAddMeal({
      name: m.name, calories: m.calories, protein: m.protein,
      carbs: m.carbs, fat: m.fat, source: m.source,
      confidence: m.confidence, notes: "Relogged", serving_size: m.serving_size,
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
      if (inputMode !== "text" && pendingFile) {
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
    } catch { setError("Something went wrong."); setLoading(false); }
  };

  const runFinal = async (
    text: string, mode: string, clar: string | null,
    b64: string | null, mime: string | null,
  ) => {
    setLoading(true);
    setLoadingMsg(mode === "label" ? "Reading label…" : mode === "text" ? "Searching & estimating…" : "Analyzing photo…");
    try {
      const result = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, text, base64: b64, mimeType: mime, clarification: clar }),
      }).then(r => r.json());
      if (result.error) { setError(result.error); setLoading(false); return; }
      const imgUrl = mode !== "text" && preview ? preview : undefined;
      await handleAddMeal(result, imgUrl, pendingMealType, pendingMealTime);
    } catch { setError("Could not estimate. Try again."); }
    finally { setLoading(false); }
  };

  const modeConfig = {
    meal:  { icon: "🍽️", label: "Meal photo" },
    label: { icon: "🏷️", label: "Nutrition label" },
    text:  { icon: "✏️", label: "Describe it" },
  } as const;

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
  const canSubmit = pendingFile || textInput.trim().length > 0;

  return (
    <div className="max-w-md mx-auto px-4 pb-16 pt-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
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
              ["Protein", totals.protein, "g", "var(--prot)"],
              ["Carbs",   totals.carbs,   "g", "var(--carb)"],
              ["Fat",     totals.fat,     "g", "var(--fat)"],
            ] as [string, number, string, string][]).map(([l, v, u, c]) => (
              <div key={l} className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-2 text-center">
                <p className="text-xs text-gray-400">{l}</p>
                <p className="text-sm font-medium" style={{ color: c }}>
                  {v}<span className="text-xs font-normal">{u}</span>
                </p>
              </div>
            ))}
          </div>
          <div className="bg-gray-100 dark:bg-zinc-700 rounded-full h-1.5 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min((totals.protein / PROTEIN_GOAL) * 100, 100)}%`, background: "var(--prot)" }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">{totals.protein}g / {PROTEIN_GOAL}g protein</p>
        </div>
      </div>

      {/* Charts */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
        <div className="flex gap-2 mb-3">
          {(["calories", "protein"] as ChartType[]).map(t => (
            <button key={t} onClick={() => setChartType(t)}
              className="text-xs px-3 py-1 rounded-full capitalize transition-colors"
              style={{ background: chartType === t ? "#f3f4f6" : "transparent", fontWeight: chartType === t ? 600 : 400, color: chartType === t ? "#111" : "#9ca3af" }}>
              {t}
            </button>
          ))}
        </div>
        <BarChart meals={meals} type={chartType} onBarClick={() => setShowAnalytics(p => !p)} />
        {showAnalytics && <AnalyticsTable meals={meals} onClose={() => setShowAnalytics(false)} />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-zinc-800 rounded-2xl p-1 mb-4">
        {([["today", "Today"], ["add", "+ Add"], ["history", "History"]] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 text-xs rounded-xl transition-all"
            style={{ background: tab === t ? "#f3f4f6" : "transparent", fontWeight: tab === t ? 600 : 400, color: tab === t ? "#111" : "#9ca3af" }}>
            {l}
          </button>
        ))}
      </div>

      {/* Today */}
      {tab === "today" && (
        <div>
          {todayMeals.length === 0
            ? <div className="text-center py-10 text-gray-400 text-sm">
                No meals today.{" "}
                <button onClick={() => setTab("add")} className="text-blue-400">Add one →</button>
              </div>
            : todayMeals.map(m => <MealCard key={m.id} meal={m} onDelete={handleDeleteMeal} onUpdate={handleUpdateMeal} />)}
          {todayMeals.length > 0 && (
            <DayLoggedButton confirmed={dayConfirmed} onToggle={toggleDayConfirmed} />
          )}
        </div>
      )}

      {/* Add meal */}
      {tab === "add" && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">Add new</p>

          {/* Mode selector */}
          <div className="flex gap-2 mb-4">
            {(Object.entries(modeConfig) as [typeof inputMode, typeof modeConfig[keyof typeof modeConfig]][]).map(([key, cfg]) => (
              <button key={key} onClick={() => { setInputMode(key); resetAdd(); }}
                className="flex-1 py-2 px-1 text-xs rounded-xl border transition-colors"
                style={{
                  background: inputMode === key ? "#f3f4f6" : "transparent",
                  fontWeight: inputMode === key ? 600 : 400,
                  borderColor: inputMode === key ? "#d1d5db" : "#e5e7eb",
                  color: inputMode === key ? "#111" : "#9ca3af",
                }}>
                <div className="text-base mb-0.5">{cfg.icon}</div>{cfg.label}
              </button>
            ))}
          </div>

          {/* Meal type + time */}
          <MealTimeEditor
            mealTime={pendingMealTime} mealType={pendingMealType}
            onChange={setPendingMealTime} onTypeChange={setPendingMealType}
          />

          {/* Clarification */}
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
              {/* Photo upload area */}
              {inputMode !== "text" && (
                !preview ? (
                  <div onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                    onDragOver={e => e.preventDefault()}
                    className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl p-6 text-center">
                    <div className="text-4xl mb-2">{modeConfig[inputMode].icon}</div>
                    <p className="text-sm font-medium mb-4">
                      {inputMode === "label" ? "Scan nutrition label" : "Upload meal photo"}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => cameraRef.current?.click()}
                        className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border border-gray-200 dark:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                        <span className="text-xl">📷</span>
                        <span className="text-xs text-gray-500">Take photo</span>
                      </button>
                      <button onClick={() => fileRef.current?.click()}
                        className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border border-gray-200 dark:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                        <span className="text-xl">🖼️</span>
                        <span className="text-xs text-gray-500">Choose from gallery</span>
                      </button>
                    </div>
                    <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => e.target.files && handleFile(e.target.files[0])} />
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

              {/* Text input for text mode */}
              {inputMode === "text" && (
                <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                  placeholder="e.g. 'Two scrambled eggs with toast' or 'McDonald's Big Mac meal'" rows={3}
                  className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
              )}

              {/* Description field for photo/label modes — always visible */}
              {inputMode !== "text" && (
                <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                  placeholder={inputMode === "label"
                    ? "Optional: describe the product or number of servings (e.g. '2 servings of Greek yogurt')"
                    : "Optional: describe the meal to improve accuracy (e.g. 'grilled salmon with steamed broccoli and brown rice')"}
                  rows={2}
                  className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
              )}

              {/* Submit */}
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

          {/* Recent foods moved to bottom of Add tab */}
          <div className="mt-6">
            <p className="text-xs font-medium text-gray-400 mb-2">Recent foods</p>
            <FoodSearch meals={meals} onRelog={handleRelog} />
          </div>
        </div>
      )}

      {/* History */}
      {tab === "history" && (() => {
        const grouped = meals.reduce<Record<string, Meal[]>>((acc, m) => {
          acc[m.meal_date] = acc[m.meal_date] || []; acc[m.meal_date].push(m); return acc;
        }, {});
        return (
          <div>
            {Object.keys(grouped).length === 0
              ? <div className="text-center py-10 text-gray-400 text-sm">No history yet.</div>
              : Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dayMeals]) => {
                  const dt = sumMacros(dayMeals);
                  return (
                    <div key={date} className="mb-5">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{fmtShort(date)}</p>
                        <p className="text-xs text-gray-400">
                          <span className="font-medium" style={{ color: "var(--cal)" }}>{dt.calories}</span> kcal ·{" "}
                          P: <span style={{ color: "var(--prot)" }}>{dt.protein}g</span> · C: {dt.carbs}g · F: {dt.fat}g
                        </p>
                      </div>
                      {dayMeals.map(m => <MealCard key={m.id} meal={m} onDelete={handleDeleteMeal} onUpdate={handleUpdateMeal} />)}
                    </div>
                  );
                })}
          </div>
        );
      })()}
    </div>
  );
}