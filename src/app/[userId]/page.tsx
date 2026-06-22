"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  getProfiles, getMeals, getMeals30Days, getAllMeals, addMeal, deleteMeal, updateMeal, markOnboarded,
  type Profile, type Meal, type MealType, type ActivityLevel, type GoalType,
} from "@/lib/db";
import {
  sumMacros, todayISO, getLast7Days,
  fmtShort, fmtWeek, fmtMonth, getWeekStart,
  DAILY_GOAL, PROTEIN_GOAL, calcCalorieGoal, calcProteinGoal,
} from "@/lib/utils";
import {
  Home as HomeIcon, History as HistoryIcon, Plus, BarChart3, User,
  UtensilsCrossed, Tag, Pencil,
  Scale, Bell, Moon, Sun, RefreshCw, CreditCard, MessageSquare,
  Shield, FileText, LogOut, ChevronRight,
} from "lucide-react";
import NativeResumeHandler from "./NativeResumeHandler";

// ── SSR-safe localStorage helpers ────────────────────────────────────────────
// During Next.js server rendering, `window` is undefined and direct localStorage
// access throws "ReferenceError: localStorage is not defined". These helpers
// no-op on the server and behave normally in the browser.
const isBrowser = () => typeof window !== "undefined";
function lsGet(key: string): string | null {
  if (!isBrowser()) return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(key, value); } catch {}
}
function lsRemove(key: string): void {
  if (!isBrowser()) return;
  try { window.localStorage.removeItem(key); } catch {}
}

// Detects when running inside the Capacitor native Android/iOS shell.
function isNativeApp(): boolean {
  if (!isBrowser()) return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

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

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportMealsCSV(meals: Meal[], profileName: string) {
  const headers = [
    "Date", "Time", "Meal Type", "Name",
    "Calories", "Protein (g)", "Carbs (g)", "Fat (g)",
    "Serving Size", "Notes", "Source", "Confidence"
  ];
  const rows = [...meals]
    .sort((a, b) => b.meal_date.localeCompare(a.meal_date))
    .map(m => [
      m.meal_date,
      new Date(m.meal_time || m.logged_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      m.meal_type ?? "",
      `"${(m.name ?? "").replace(/"/g, '""')}"`,
      m.calories, m.protein, m.carbs, m.fat,
      `"${(m.serving_size ?? "").replace(/"/g, '""')}"`,
      `"${(m.notes ?? "").replace(/"/g, '""')}"`,
      m.source ?? "", m.confidence ?? "",
    ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calor-iq-${profileName.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── WeeklyCard ────────────────────────────────────────────────────────────────
function WeeklyCard({
  meals, calorieGoal, showInsights, insightsLoading, insightsText, isSunday, onToggleInsights, confirmedDates,
}: {
  meals: Meal[]; calorieGoal: number;
  showInsights: boolean; insightsLoading: boolean; insightsText: string;
  isSunday: boolean; onToggleInsights: () => void;
  confirmedDates: Set<string>;
}) {
  const last7 = getLast7Days();
  const weekMeals = meals.filter(m => last7.includes(m.meal_date));

  const dailyTotals = last7.map(date => {
    const dayMeals = weekMeals.filter(m => m.meal_date === date);
    return { date, calories: sumMacros(dayMeals).calories, confirmed: confirmedDates.has(date) };
  }).filter(d => d.confirmed && d.calories > 0);

  const daysLogged = dailyTotals.length;

  const avgCalories = daysLogged
    ? Math.round(dailyTotals.reduce((s, d) => s + d.calories, 0) / daysLogged)
    : 0;

  const bestDay = daysLogged
    ? dailyTotals.reduce((best, d) =>
        Math.abs(d.calories - calorieGoal) < Math.abs(best.calories - calorieGoal) ? d : best
      )
    : null;

  const diff = avgCalories - calorieGoal;
  const diffLabel = diff === 0 ? "on target" : diff > 0 ? `+${diff} over goal` : `${Math.abs(diff)} under goal`;
  const diffColor = Math.abs(diff) < 100 ? "#22C55E" : Math.abs(diff) < 300 ? "#F59E0B" : "#E24B4A";

  if (weekMeals.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl mb-4 overflow-hidden">
      <button onClick={onToggleInsights} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-left">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: isSunday ? "#FEF3C7" : "#F3F4F6" }}>
          {isSunday ? "📋" : "🧠"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            {isSunday ? "Weekly review ready" : "This week so far"}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {daysLogged > 0
              ? <>Logged {daysLogged} full day{daysLogged !== 1 ? "s" : ""} this week · avg <span style={{ color: diffColor, fontWeight: 600 }}>{avgCalories} kcal</span><span style={{ color: diffColor }}> ({diffLabel})</span>{bestDay && ` · best: ${new Date(bestDay.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}`}</>
              : "Confirm a day with ✅ to see your weekly average"}
          </p>
        </div>
        <span className="text-gray-300 text-xs flex-shrink-0">{showInsights ? "▲" : "▼"}</span>
      </button>

      {showInsights && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-zinc-800 pt-3">
          {insightsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-3 justify-center">
              <span className="animate-pulse">⏳</span>
              <span>Analyzing your week…</span>
            </div>
          ) : insightsText ? (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{insightsText}</p>
          ) : null}
        </div>
      )}

    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function OnboardingFlow({
  profile,
  onComplete,
}: {
  profile: Profile;
  onComplete: (stats: {
    weight_kg: number | null; height_cm: number | null;
    age: number | null; gender: string;
    activity_level: ActivityLevel; goal_type: GoalType;
  }) => void;
}) {
  const [step, setStep] = useState(0);
  const [weight, setWeight]     = useState("");
  const [height, setHeight]     = useState("");
  const [age, setAge]           = useState("");
  const [gender, setGender]     = useState<"male"|"female"|"other"|"">("");
  const [activity, setActivity] = useState<ActivityLevel | "">("");
  const [goal, setGoal]         = useState<GoalType | "">("");
  const [useImperial, setUseImperial] = useState(false);
  const [saving, setSaving]     = useState(false);

  const weightKg = useImperial && weight ? Math.round(parseFloat(weight) / 2.2046 * 10) / 10 : parseFloat(weight) || null;
  const heightCm = useImperial && height ? Math.round(parseFloat(height) * 30.48 + (parseFloat("0") * 2.54)) : parseFloat(height) || null;

  const previewGoal = calcCalorieGoal({
    weight_kg: weightKg, height_cm: heightCm,
    age: parseFloat(age) || null, gender: gender || null,
    activity_level: activity || null, goal_type: goal || null,
  });

  const ACTIVITIES: { key: ActivityLevel; label: string; desc: string; emoji: string }[] = [
    { key: "sedentary", label: "Sedentary",  desc: "Desk job, little exercise",       emoji: "🪑" },
    { key: "light",     label: "Light",      desc: "Light exercise 1–3×/week",        emoji: "🚶" },
    { key: "moderate",  label: "Moderate",   desc: "Exercise 3–5×/week",              emoji: "🏃" },
    { key: "active",    label: "Active",     desc: "Hard exercise 6–7×/week",         emoji: "💪" },
  ];

  const GOALS: { key: GoalType; label: string; desc: string; emoji: string; adj: string }[] = [
    { key: "lose",     label: "Lose weight",    desc: "−300 kcal/day deficit",   emoji: "📉", adj: "text-blue-500" },
    { key: "maintain", label: "Stay the same",  desc: "Maintain current weight", emoji: "⚖️",  adj: "text-green-500" },
    { key: "gain",     label: "Build muscle",   desc: "+300 kcal/day surplus",   emoji: "📈", adj: "text-orange-500" },
  ];

  const handleFinish = async () => {
    setSaving(true);
    const stats = {
      weight_kg: weightKg,
      height_cm: heightCm,
      age: parseFloat(age) || null,
      gender: gender || "other",
      activity_level: (activity || "moderate") as ActivityLevel,
      goal_type: (goal || "maintain") as GoalType,
    };
    onComplete(stats);
  };

  const canAdvanceStep1 = weight && height && age && gender;

  return (
    <div className="fixed inset-0 bg-white dark:bg-zinc-950 z-50 flex flex-col overflow-y-auto">
      <div className="max-w-md mx-auto w-full px-6 py-10 flex flex-col min-h-full">

        <div className="flex justify-center gap-2 mb-8">
          {[0,1,2].map(i => (
            <div key={i} className="h-1.5 rounded-full transition-all"
              style={{ width: step === i ? 24 : 8, background: step >= i ? "#111" : "#e5e7eb" }} />
          ))}
        </div>

        {step === 0 && (
          <div className="flex-1 flex flex-col">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4"
                style={{ background: profile.avatar_bg }}>
                {profile.photo_url
                  ? <img src={profile.photo_url} className="w-16 h-16 rounded-2xl object-cover" alt="" />
                  : profile.avatar}
              </div>
              <h1 className="text-2xl font-bold mb-1">Hey, {profile.name.split(" ")[0]}! 👋</h1>
              <p className="text-sm text-gray-400">Let's set up your personal calorie goal.<br />Takes 30 seconds.</p>
            </div>

            <div className="flex justify-end mb-4">
              <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5 text-xs">
                <button onClick={() => setUseImperial(false)}
                  className="px-3 py-1 rounded-md transition-all"
                  style={{ background: !useImperial ? "#fff" : "transparent", fontWeight: !useImperial ? 600 : 400, color: !useImperial ? "#111" : "#6b7280" }}>
                  kg/cm
                </button>
                <button onClick={() => setUseImperial(true)}
                  className="px-3 py-1 rounded-md transition-all"
                  style={{ background: useImperial ? "#fff" : "transparent", fontWeight: useImperial ? 600 : 400, color: useImperial ? "#111" : "#6b7280" }}>
                  lbs/ft
                </button>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Weight ({useImperial ? "lbs" : "kg"})</label>
                  <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
                    placeholder={useImperial ? "154" : "70"}
                    className="w-full border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-3 text-sm bg-transparent outline-none focus:border-gray-400" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Height ({useImperial ? "ft" : "cm"})</label>
                  <input type="number" value={height} onChange={e => setHeight(e.target.value)}
                    placeholder={useImperial ? "5.9" : "175"}
                    className="w-full border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-3 text-sm bg-transparent outline-none focus:border-gray-400" />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Age</label>
                  <input type="number" value={age} onChange={e => setAge(e.target.value)}
                    placeholder="28"
                    className="w-full border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-3 text-sm bg-transparent outline-none focus:border-gray-400" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Gender</label>
                  <div className="flex gap-1.5">
                    {(["male","female","other"] as const).map(g => (
                      <button key={g} onClick={() => setGender(g)}
                        className="flex-1 py-3 rounded-xl border text-xs capitalize transition-all"
                        style={{
                          background: gender === g ? "#111" : "transparent",
                          borderColor: gender === g ? "#111" : "#e5e7eb",
                          color: gender === g ? "#fff" : "#9ca3af",
                          fontWeight: gender === g ? 600 : 400,
                        }}>{g === "other" ? "?" : g === "male" ? "M" : "F"}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-auto space-y-2">
              <button onClick={() => setStep(1)} disabled={!canAdvanceStep1}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-30"
                style={{ background: "#111", color: "#fff" }}>
                Continue →
              </button>
              <button onClick={() => onComplete({ weight_kg: null, height_cm: null, age: null, gender: "other", activity_level: "moderate", goal_type: "maintain" })}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col">
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-1">How active are you?</h2>
              <p className="text-sm text-gray-400">This adjusts your daily calorie target.</p>
            </div>
            <div className="space-y-2 mb-6">
              {ACTIVITIES.map(({ key, label, desc, emoji }) => (
                <button key={key} onClick={() => setActivity(key)}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-left transition-all"
                  style={{
                    borderColor: activity === key ? "#111" : "#e5e7eb",
                    background: activity === key ? "#f9fafb" : "transparent",
                  }}>
                  <span className="text-2xl">{emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </div>
                  {activity === key && <span className="text-sm">✓</span>}
                </button>
              ))}
            </div>
            <div className="mt-auto space-y-2">
              <button onClick={() => setStep(2)} disabled={!activity}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-30"
                style={{ background: "#111", color: "#fff" }}>
                Continue →
              </button>
              <button onClick={() => setStep(0)} className="w-full py-2 text-xs text-gray-400 hover:text-gray-600">← Back</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col">
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-1">What's your goal?</h2>
              <p className="text-sm text-gray-400">We'll adjust your calorie target accordingly.</p>
            </div>
            <div className="space-y-2 mb-6">
              {GOALS.map(({ key, label, desc, emoji }) => (
                <button key={key} onClick={() => setGoal(key)}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-left transition-all"
                  style={{
                    borderColor: goal === key ? "#111" : "#e5e7eb",
                    background: goal === key ? "#f9fafb" : "transparent",
                  }}>
                  <span className="text-2xl">{emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </div>
                  {goal === key && <span className="text-sm">✓</span>}
                </button>
              ))}
            </div>

            {previewGoal && goal && (
              <div className="bg-gray-50 dark:bg-zinc-800 rounded-2xl p-4 mb-6 text-center">
                <p className="text-xs text-gray-400 mb-1">Your daily calorie goal</p>
                <p className="text-4xl font-bold" style={{ color: "var(--cal)" }}>{previewGoal}</p>
                <p className="text-xs text-gray-400 mt-1">kcal / day</p>
              </div>
            )}

            <div className="mt-auto space-y-2">
              <button onClick={handleFinish} disabled={!goal || saving}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-30"
                style={{ background: "#111", color: "#fff" }}>
                {saving ? "Saving…" : "Let's go! 🚀"}
              </button>
              <button onClick={() => setStep(1)} className="w-full py-2 text-xs text-gray-400 hover:text-gray-600">← Back</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

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
  const dateOptions = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const label = i === 0 ? "Today" : i === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      return { iso, label };
    });
  }, []);

  const selectedDate = mealTime.toISOString().split("T")[0];

  const handleDateChange = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const next = new Date(mealTime);
    next.setFullYear(y, m - 1, d);
    onChange(next);
  };

  return (
    <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-3 mb-3">
      <p className="text-xs font-medium text-gray-400 mb-2">Log date</p>
      <div className="flex gap-1 overflow-x-auto pb-1 mb-3 scrollbar-hide">
        {dateOptions.map(({ iso, label }) => (
          <button key={iso} onClick={() => handleDateChange(iso)}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all whitespace-nowrap"
            style={{
              background: selectedDate === iso ? "#111" : "transparent",
              borderColor: selectedDate === iso ? "#111" : "#d1d5db",
              color: selectedDate === iso ? "#fff" : "#4b5563",
              fontWeight: selectedDate === iso ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>
      <p className="text-xs font-medium text-gray-400 mb-2">Meal type</p>
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {MEAL_TYPES.map(({ key, label, emoji }) => {
          const active = mealType === key;
          return (
            <button key={key} onClick={() => onTypeChange(key)}
              className="flex flex-col items-center py-2 rounded-xl border text-xs transition-all"
              style={{
                background: active ? MEAL_TYPE_COLORS[key] + "18" : "transparent",
                borderColor: active ? MEAL_TYPE_COLORS[key] : "#d1d5db",
                color: active ? MEAL_TYPE_COLORS[key] : "#4b5563",
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
function BarChart({ meals, type, onBarClick, calorieGoal: calGoal, proteinGoal: protGoal }: { meals: Meal[]; type: ChartType; onBarClick: () => void; calorieGoal: number; proteinGoal: number }) {
  const [showAvg, setShowAvg] = useState(false);
  const days = getLast7Days();
  const goal = type === "calories" ? calGoal : protGoal;
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
              style={{ background: period === p ? "#f3f4f6" : "transparent", fontWeight: period === p ? 600 : 400, color: period === p ? "#111" : "#6b7280" }}>
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
function fuzzyMatch(name: string, notes: string | null, query: string): boolean {
  const haystack = (name + " " + (notes ?? "")).toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (haystack.includes(q)) return true;
  const words = q.split(/\s+/);
  return words.every(w => haystack.includes(w));
}

// #32 — max 5 pinned favorites, stored per-user in localStorage
const MAX_FAVS = 5;
function getFavKeys(userId: string): string[] {
  try { return JSON.parse(lsGet(`favs:${userId}`) ?? "[]"); } catch { return []; }
}
function saveFavKeys(userId: string, keys: string[]) {
  lsSet(`favs:${userId}`, JSON.stringify(keys));
}

function FoodSearch({ meals, onRelog, userId }: { meals: Meal[]; onRelog: (m: Meal) => void; userId: string }) {
  const [q, setQ] = useState("");
  const [favKeys, setFavKeys] = useState<string[]>(() => getFavKeys(userId));

  const unique = useMemo(() => {
    const seen = new Map<string, Meal>();
    [...meals].sort((a, b) => b.meal_date.localeCompare(a.meal_date))
      .forEach(m => { if (!seen.has(m.name.toLowerCase())) seen.set(m.name.toLowerCase(), m); });
    return Array.from(seen.values());
  }, [meals]);

  const favMeals = useMemo(() =>
    favKeys.map(k => unique.find(m => m.name.toLowerCase() === k)).filter(Boolean) as Meal[],
    [favKeys, unique]);

  const toggleFav = (m: Meal) => {
    const key = m.name.toLowerCase();
    setFavKeys(prev => {
      const next = prev.includes(key)
        ? prev.filter(k => k !== key)
        : prev.length >= MAX_FAVS ? prev : [...prev, key];
      saveFavKeys(userId, next);
      return next;
    });
  };

  const filtered = q.trim() ? unique.filter(m => fuzzyMatch(m.name, m.notes, q)) : unique.slice(0, 8);

  const MealRow = ({ m, i, total }: { m: Meal; i: number; total: number }) => {
    const isFav = favKeys.includes(m.name.toLowerCase());
    return (
      <div className="flex items-center"
        style={{ borderBottom: i < total - 1 ? "1px solid #e5e7eb" : "none" }}>
        <button onClick={() => onRelog(m)}
          className="flex-1 flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800 text-left transition-colors min-w-0 gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{m.name}</p>
            <p className="text-xs text-gray-400 truncate">P: {m.protein}g · C: {m.carbs}g · F: {m.fat}g</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-medium whitespace-nowrap" style={{ color: "var(--cal)" }}>{m.calories} kcal</span>
            <span className="text-xs text-blue-500 font-medium whitespace-nowrap">+ Add</span>
          </div>
        </button>
        <button onClick={() => toggleFav(m)}
          className="px-3 py-2 text-base transition-opacity"
          style={{ opacity: isFav ? 1 : 0.25 }}
          title={isFav ? "Remove from favorites" : favKeys.length >= MAX_FAVS ? "Max 5 favorites" : "Pin to favorites"}>
          ⭐
        </button>
      </div>
    );
  };

  return (
    <div className="mb-4">
      {favMeals.length > 0 && !q.trim() && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-400 mb-1.5">⭐ Favorites</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {favMeals.map(m => (
              <button key={m.id} onClick={() => onRelog(m)}
                className="flex-shrink-0 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-left min-w-[120px] max-w-[150px] hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors">
                <p className="text-xs font-semibold truncate">{m.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--cal)" }}>{m.calories} kcal</p>
              </button>
            ))}
          </div>
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search previously logged foods…"
        className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 mb-2" />
      {filtered.length > 0 && (
        <div className="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">
          {filtered.map((m, i) => <MealRow key={m.id} m={m} i={i} total={filtered.length} />)}
        </div>
      )}
    </div>
  );
}

// ── ShareDaySummaryCard ──────────────────────────────────────────────────────
function ShareDaySummaryCard({
  name, date, calories, calorieGoal, protein, carbs, fat, streak, onClose,
}: {
  name: string; date: string; calories: number; calorieGoal: number;
  protein: number; carbs: number; fat: number; streak: number; onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const friendlyDate = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  const pct = Math.min(Math.round((calories / calorieGoal) * 100), 999);
  const onTarget = Math.abs(calories - calorieGoal) < 150;
  const over = calories > calorieGoal + 150;
  const statusEmoji = onTarget ? "🎯" : over ? "📈" : "📉";
  const statusText = onTarget ? "Right on target!" : over ? `${calories - calorieGoal} kcal over goal` : `${calorieGoal - calories} kcal under goal`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 640, H = 360;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#0f0f1a");
    grad.addColorStop(1, "#1a1230");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.beginPath();
    ctx.arc(W + 60, -60, 280, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(127,119,221,0.08)";
    ctx.fill();

    ctx.fillStyle = "#7F77DD";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillText("Caloriq", 36, 48);

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(friendlyDate, 36, 70);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText(name, 36, 95);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.fillText(String(calories), 36, 185);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("kcal", 36 + ctx.measureText(String(calories)).width + 10, 178);

    const barX = 36, barY = 200, barW = 360, barH = 8;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fill();
    const fillW = Math.min((calories / calorieGoal) * barW, barW);
    ctx.fillStyle = onTarget ? "#22C55E" : over ? "#E24B4A" : "#7F77DD";
    roundRect(ctx, barX, barY, fillW, barH, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(`${pct}% of ${calorieGoal} kcal goal`, barX, 228);

    ctx.fillStyle = onTarget ? "#22C55E" : over ? "#E24B4A" : "#A78BFA";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillText(`${statusEmoji}  ${statusText}`, barX, 255);

    const macros = [
      { label: "Protein", value: `${protein}g`, color: "#1D9E75" },
      { label: "Carbs",   value: `${carbs}g`,   color: "#378ADD" },
      { label: "Fat",     value: `${fat}g`,     color: "#EF9F27" },
    ];
    macros.forEach((m, i) => {
      const mx = barX + i * 120;
      const my = 300;
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      roundRect(ctx, mx, my, 108, 44, 10);
      ctx.fill();
      ctx.fillStyle = m.color;
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillText(m.value, mx + 12, my + 20);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(m.label, mx + 12, my + 36);
    });

    if (streak > 0) {
      ctx.fillStyle = "rgba(249,115,22,0.15)";
      roundRect(ctx, W - 130, 36, 96, 36, 18);
      ctx.fill();
      ctx.fillStyle = "#f97316";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(`🔥 ${streak} day${streak > 1 ? "s" : ""}`, W - 117, 59);
    }

    setShareUrl(canvas.toDataURL("image/png"));
  }, [calories, calorieGoal, protein, carbs, fat, streak, friendlyDate, name, onTarget, over, pct, statusText]);

  const handleDownload = () => {
    if (!shareUrl) return;
    const a = document.createElement("a");
    a.href = shareUrl;
    a.download = `caloriq-${date}.png`;
    a.click();
  };

  const handleShare = async () => {
    if (!shareUrl) return;
    if (navigator.share && navigator.canShare) {
      try {
        const blob = await (await fetch(shareUrl)).blob();
        const file = new File([blob], `caloriq-${date}.png`, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "My daily nutrition — Caloriq" });
          return;
        }
      } catch { /* fall through */ }
    }
    try {
      const blob = await (await fetch(shareUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      handleDownload();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Share today's summary</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-4">
          <canvas ref={canvasRef} className="w-full rounded-xl" style={{ display: shareUrl ? "block" : "none" }} />
          {!shareUrl && <div className="h-40 bg-gray-100 dark:bg-zinc-800 rounded-xl animate-pulse" />}
          <div className="flex gap-2 mt-3">
            <button onClick={handleShare}
              className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
              {copied ? "✅ Copied!" : "📤 Share"}
            </button>
            <button onClick={handleDownload}
              className="flex-1 bg-gray-100 dark:bg-zinc-700 hover:bg-gray-200 dark:hover:bg-zinc-600 text-gray-700 dark:text-gray-200 rounded-xl py-2.5 text-sm font-medium transition-colors">
              ⬇️ Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Friendly error messages ─────────────────────────────────────────────────
function friendlyError(raw: string): { emoji: string; message: string; hint: string } {
  const r = raw.toLowerCase();
  if (r.includes("fetch") || r.includes("network") || r.includes("failed to fetch"))
    return { emoji: "📡", message: "No internet connection", hint: "Check your connection and try again." };
  if (r.includes("timeout") || r.includes("timed out") || r.includes("deadline"))
    return { emoji: "⏱️", message: "Taking too long", hint: "The server is busy. Try again in a moment." };
  if (r.includes("parse") || r.includes("json") || r.includes("incomplete"))
    return { emoji: "🤔", message: "Couldn't understand that", hint: "Try describing the food differently or use a clearer photo." };
  if (r.includes("label") || r.includes("illegible") || r.includes("blurry"))
    return { emoji: "📸", message: "Label is hard to read", hint: "Try better lighting or hold the camera closer." };
  if (r.includes("limit") || r.includes("rate"))
    return { emoji: "🚦", message: "Too many requests", hint: "Wait a moment and try again." };
  if (r.includes("image") || r.includes("photo") || r.includes("base64"))
    return { emoji: "🖼️", message: "Problem with the photo", hint: "Try taking a new photo or use text mode instead." };
  return { emoji: "😕", message: "Something went wrong", hint: "Tap retry or try describing the food as text." };
}

// ── MealCard ──────────────────────────────────────────────────────────────────
function MealCard({ meal: m, onDelete, onUpdate, profileId, onFlag }: {
  meal: Meal;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Meal>) => void;
  profileId: string;
  onFlag: (meal: Meal) => void;
}) {
  const [editing, setEditing] = useState(false);
  const originalDesc = m.notes?.trim() || m.name;
  const [editDescription, setEditDescription] = useState(originalDesc);
  const [editType, setEditType] = useState<MealType>(m.meal_type);
  const [editTime, setEditTime] = useState<Date>(() => new Date(m.meal_time || m.logged_at));
  const [editDate, setEditDate] = useState<string>(() => (m.meal_time || m.logged_at).split("T")[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditDescription(m.notes?.trim() || m.name);
    setEditType(m.meal_type);
    setEditTime(new Date(m.meal_time || m.logged_at));
    setEditDate((m.meal_time || m.logged_at).split("T")[0]);
  }, [m.id, m.notes, m.name, m.meal_type, m.meal_time, m.logged_at]);

  const time = new Date(m.meal_time || m.logged_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const typeInfo = MEAL_TYPES.find(t => t.key === m.meal_type);

  const handleSave = async () => {
    setSaving(true);
    const mergedTime = new Date(editTime);
    const [ey, em, ed] = editDate.split("-").map(Number);
    mergedTime.setFullYear(ey, em - 1, ed);
    const mergedIso = mergedTime.toISOString();
    try {
      const currentDesc = m.notes?.trim() || m.name;
      const descChanged = editDescription.trim() !== currentDesc.trim();
      if (descChanged && editDescription.trim()) {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "text", text: editDescription.trim(),
            base64: null, mimeType: null, clarification: null,
            profileId: profileId,
          }),
        }).then(r => r.json());
        if (!res.error && !res.needsClarification) {
          onUpdate(m.id, {
            calories: res.calories, protein: res.protein, carbs: res.carbs, fat: res.fat,
            serving_size: res.serving_size ?? m.serving_size,
            name: res.name ?? editDescription.trim(),
            notes: editDescription.trim(), meal_type: editType, meal_time: mergedIso, meal_date: editDate,
          });
        } else {
          onUpdate(m.id, { notes: editDescription.trim(), meal_type: editType, meal_time: mergedIso, meal_date: editDate });
        }
      } else {
        onUpdate(m.id, { meal_type: editType, meal_time: mergedIso, meal_date: editDate });
      }
      setEditing(false);
    } catch {
      onUpdate(m.id, { notes: editDescription.trim(), meal_type: editType, meal_time: mergedIso, meal_date: editDate });
      setEditing(false);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-3 mb-2">
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
            <button onClick={() => { setEditing(e => !e) }} className="text-xs text-gray-300 hover:text-blue-400 transition-colors">✏️</button>
            <button onClick={() => onFlag(m)} className="text-xs text-gray-300 hover:text-amber-400 transition-colors" title="Calories seem off?">🚩</button>
            <button onClick={() => onDelete(m.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">✕</button>
          </div>
        </div>
      </div>
      {editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-3">
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
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Entry date</p>
            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Food description</p>
            <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
              placeholder="Describe the food to re-analyze (e.g. 'grilled chicken breast 200g, no sauce')"
              rows={2}
              className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
            <p className="text-xs text-gray-400 mt-1">Edit the description and save to re-analyze with AI ✨</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)}
              className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm text-gray-400">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-[2] bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm font-medium disabled:opacity-40">
              {saving ? (editDescription.trim() !== (m.notes?.trim() || m.name) ? "Re-analyzing…" : "Saving…") : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DayLoggedButton ───────────────────────────────────────────────────────────
function DayLoggedButton({ confirmed, onToggle, isToday = true }: { confirmed: boolean; onToggle: () => void; isToday?: boolean }) {
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
        {confirmed
          ? "Day logged — all meals recorded!"
          : isToday
            ? "Confirm I've logged everything today"
            : "Mark this day as fully logged"}
      </span>
    </button>
  );
}

// ── MacroRatioBar ─────────────────────────────────────────────────────────────
function MacroRatioBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const proteinCal = protein * 4;
  const carbsCal   = carbs * 4;
  const fatCal     = fat * 9;
  const total = proteinCal + carbsCal + fatCal;
  if (total === 0) return null;
  const pPct = Math.round((proteinCal / total) * 100);
  const cPct = Math.round((carbsCal   / total) * 100);
  const fPct = 100 - pPct - cPct;
  return (
    <div className="mt-3 w-full">
      <div className="flex rounded-full overflow-hidden h-2 gap-px">
        <div style={{ width: `${pPct}%` }} className="bg-blue-400 dark:bg-blue-500 transition-all duration-500" />
        <div style={{ width: `${cPct}%` }} className="bg-amber-400 dark:bg-amber-500 transition-all duration-500" />
        <div style={{ width: `${fPct}%` }} className="bg-rose-400 dark:bg-rose-500 transition-all duration-500" />
      </div>
      <div className="flex justify-between text-[10px] mt-1.5 text-gray-400 dark:text-gray-500 font-medium">
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-1 align-middle" />Protein {pPct}%</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1 align-middle" />Carbs {cPct}%</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 mr-1 align-middle" />Fat {fPct}%</span>
      </div>
    </div>
  );
}

// ── NavButton (bottom nav) ────────────────────────────────────────────────────
function NavButton({ icon: Icon, label, active, onClick }: { icon: any; label: string; active?: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors" style={{ color: active ? "#7F77DD" : "#9ca3af" }}>
      <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
      <span className="text-[10px]" style={{ fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}

// ── MenuItem (profile sheet) ──────────────────────────────────────────────────
function MenuItem({ icon: Icon, label, onClick, danger, right }: { icon: any; label: string; onClick: () => void; danger?: boolean; right?: React.ReactNode; }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-6 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-left">
      <Icon className="w-5 h-5 flex-shrink-0" style={{ color: danger ? "#E24B4A" : "#6b7280" }} strokeWidth={2} />
      <span className="flex-1 text-sm" style={{ color: danger ? "#E24B4A" : undefined, fontWeight: danger ? 600 : 500 }}>{label}</span>
      {right ?? <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TrackerPage() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const searchParams = useSearchParams();
  const justUpgraded = searchParams.get("upgraded") === "true";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [ready, setReady] = useState(false);

  const [tab, setTab] = useState<"today" | "history" | "add">("add");
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
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [historyMeals, setHistoryMeals] = useState<Meal[]>([]);
  const [showBodyStats, setShowBodyStats] = useState(false);
  const [bodyStats, setBodyStats] = useState({ weight_kg: "", height_cm: "", age: "", gender: "", activity_level: "", goal_type: "" });
  const [savingStats, setSavingStats] = useState(false);
  const [showForgotNudge, setShowForgotNudge] = useState(false);
  const [feedbackMeal, setFeedbackMeal] = useState<Meal | null>(null);
  const [mealFeedbackText, setMealFeedbackText] = useState("");
  const [mealFeedbackSaving, setMealFeedbackSaving] = useState(false);
  const [showDietReport, setShowDietReport] = useState(false);
  const [dietReportText, setDietReportText] = useState("");
  const [dietReportLoading, setDietReportLoading] = useState(false);
  const [useImperial, setUseImperial] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("calories");
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ b64: string; mime: string } | null>(null);

  const [pendingMealTime, setPendingMealTime] = useState<Date>(() => floorTo30(new Date()));
  const [pendingMealType, setPendingMealType] = useState<MealType>(() => suggestMealType(new Date()));
  const [dayConfirmed, setDayConfirmed] = useState(false);
  const [waterGlasses, setWaterGlasses] = useState(0);
  const [rolloverEnabled, setRolloverEnabled] = useState(false);
  const [rolloverCalories, setRolloverCalories] = useState(0);
  const [showRolloverPrompt, setShowRolloverPrompt] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [insightsText, setInsightsText] = useState("");
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsFetchedFor, setInsightsFetchedFor] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [notifTime, setNotifTime] = useState("20:00");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const today = todayISO();

  useEffect(() => {
    const stored = lsGet(`dayConfirmed:${userId}`);
    if (stored === today) setDayConfirmed(true);
    const rv = lsGet(`caloriq-rollover-${userId}`);
    setRolloverEnabled(rv === "true");
    const savedTheme = lsGet("caloriq-theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      lsSet("caloriq-theme", "light");
      setIsDark(false);
    }
    const w = lsGet(`water:${userId}:${today}`);
    if (w) setWaterGlasses(parseInt(w) || 0);
    import("@/lib/supabase").then(({ supabase }) => {
      supabase.from("day_confirmed")
        .select("date")
        .eq("profile_id", userId)
        .eq("date", today)
        .single()
        .then(({ data }) => {
          if (data) {
            setDayConfirmed(true);
            lsSet(`dayConfirmed:${userId}`, today);
          }
        });
    });
  }, [userId, today]);

  const toggleDayConfirmed = async () => {
    const next = !dayConfirmed;
    setDayConfirmed(next);
    const { supabase } = await import("@/lib/supabase");
    if (next) {
      lsSet(`dayConfirmed:${userId}`, today);
      await supabase.from("day_confirmed").upsert({
        profile_id: userId,
        date: today,
        confirmed_at: new Date().toISOString(),
      }, { onConflict: "profile_id,date" });
    } else {
      lsRemove(`dayConfirmed:${userId}`);
      await supabase.from("day_confirmed")
        .delete()
        .eq("profile_id", userId)
        .eq("date", today);
    }
  };

  // FIX #3 — Capacitor Android hardware back button.
  // Closes the topmost open modal first; if nothing is open, minimizes the app
  // (instead of killing it). Only registers inside the native shell, so web/PWA
  // users get normal browser back behaviour.
  useEffect(() => {
    if (!isNativeApp()) return;
    let listener: any = null;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        listener = await App.addListener("backButton", () => {
          if (showProfileMenu)     { setShowProfileMenu(false); return; }
          if (showShareCard)       { setShowShareCard(false); return; }
          if (showUpgrade)         { setShowUpgrade(false); return; }
          if (showFeedback)        { setShowFeedback(false); return; }
          if (showAvatarPicker)    { setShowAvatarPicker(false); return; }
          if (showNotifSettings)   { setShowNotifSettings(false); return; }
          if (showBodyStats)       { setShowBodyStats(false); return; }
          if (feedbackMeal)        { setFeedbackMeal(null); return; }
          if (showDietReport)      { setShowDietReport(false); return; }
          if (showRolloverPrompt)  { setShowRolloverPrompt(false); return; }
          if (showForgotNudge)     { setShowForgotNudge(false); return; }
          if (showAnalytics)       { setShowAnalytics(false); return; }
          if (showOnboarding)      { return; } // onboarding isn't dismissible
          App.minimizeApp();
        });
      } catch {}
    })();
    return () => { listener?.remove?.(); };
  }, [showProfileMenu, showShareCard, showUpgrade, showFeedback, showAvatarPicker,
      showNotifSettings, showBodyStats, feedbackMeal, showDietReport,
      showRolloverPrompt, showForgotNudge, showAnalytics, showOnboarding]);

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPermission(Notification.permission);
    }
    const saved = lsGet(`caloriq-notif-time-${userId}`);
    if (saved) setNotifTime(saved);
  }, [userId]);

  useEffect(() => {
    getProfiles().then(profs => {
      const p = profs.find(x => x.id === userId);
      if (!p) { router.push("/"); return; }
      setProfile(p);
      setReady(true);
      if (!p.onboarded_at) setShowOnboarding(true);
      getMeals(userId).then(ms => setMeals(ms)).catch(() => {});
      getMeals30Days(userId).then(ms => setHistoryMeals(ms)).catch(() => {});
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

  const calorieGoal = useMemo(() => calcCalorieGoal({
    weight_kg: profile?.weight_kg ?? null,
    height_cm: profile?.height_cm ?? null,
    age: profile?.age ?? null,
    gender: profile?.gender ?? null,
    activity_level: profile?.activity_level ?? null,
    goal_type: profile?.goal_type ?? null,
  }) ?? DAILY_GOAL, [profile]);
  const proteinGoal = useMemo(() => calcProteinGoal(profile?.weight_kg ?? null), [profile]);

  useEffect(() => {
    if (!rolloverEnabled) { setRolloverCalories(0); return; }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toISOString().slice(0, 10);
    const yTotal = sumMacros(meals.filter(m => m.meal_date === yd)).calories;
    const deficit = Math.max(0, calorieGoal - yTotal);
    setRolloverCalories(Math.min(deficit, Math.round(calorieGoal * 0.2)));
  }, [rolloverEnabled, meals, calorieGoal]);

  useEffect(() => {
    if (todayMeals.length === 0) return;
    const hour = new Date().getHours();
    if (hour < 19) return;
    const lastMealTime = Math.max(...todayMeals.map(m => new Date(m.meal_time || m.logged_at).getTime()));
    const hoursSinceLast = (Date.now() - lastMealTime) / 3_600_000;
    if (hoursSinceLast >= 4 && !lsGet(`nudge:${userId}:${today}`)) {
      setShowForgotNudge(true);
    }
  }, [todayMeals, userId, today]);

  const confirmedDates = useMemo(() => {
    const last7 = getLast7Days();
    const set = new Set<string>();
    for (const date of last7) {
      const isToday = date === today;
      const confirmed = isToday
        ? dayConfirmed
        : lsGet(`dayConfirmed:${userId}:${date}`) === "true";
      if (confirmed) set.add(date);
    }
    return set;
  }, [userId, today, dayConfirmed, meals]);

  const streak = useMemo(() => {
    const loggedDates = new Set([
      ...historyMeals.map(m => m.meal_date),
      ...(todayMeals.length > 0 ? [today] : []),
    ]);
    let count = 0;
    const d = new Date();
    if (!loggedDates.has(today)) d.setDate(d.getDate() - 1);
    while (true) {
      const dateStr = d.toISOString().split("T")[0];
      if (!loggedDates.has(dateStr)) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [historyMeals, todayMeals, today]);

  const handleAddMeal = useCallback(async (
    result: Omit<Meal, "id" | "logged_at" | "profile_id" | "image_url" | "meal_date" | "meal_type" | "meal_time">,
    imgUrl?: string, mealType?: MealType, mealTime?: Date,
  ) => {
    const mt = mealTime ?? pendingMealTime;
    const mealDate = [
      mt.getFullYear(),
      String(mt.getMonth() + 1).padStart(2, "0"),
      String(mt.getDate()).padStart(2, "0"),
    ].join("-");
    const saved = await addMeal({
      ...result, profile_id: userId,
      image_url: imgUrl ?? null,
      meal_date: mealDate,
      meal_type: mealType ?? pendingMealType,
      meal_time: mt.toISOString(),
    });
    setMeals(prev => [saved, ...prev]);
    if (mealDate !== today) {
      setHistoryMeals(prev => [saved, ...prev]);
    }
    setPreview(null); setPendingFile(null); setTextInput("");
    setClar(null); setPendingB64(null); setPendingMime(null);
    if (!lsGet("caloriq-rollover-asked")) {
      setShowRolloverPrompt(true);
      lsSet("caloriq-rollover-asked", "true");
    }
    setTab(mealDate === today ? "today" : "history");
  }, [userId, today, pendingMealType, pendingMealTime]);

  const handleDeleteMeal = useCallback(async (id: string) => {
    await deleteMeal(id);
    setMeals(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleUpdateMeal = useCallback(async (id: string, updates: Partial<Meal>) => {
    const updated = await updateMeal(id, updates);
    setMeals(prev => prev.map(m => m.id === id ? updated : m));
    setHistoryMeals(prev => prev.map(m => m.id === id ? updated : m));
  }, []);

  const handleOnboardingComplete = async (stats: {
    weight_kg: number | null; height_cm: number | null;
    age: number | null; gender: string;
    activity_level: ActivityLevel; goal_type: GoalType;
  }) => {
    try {
      await markOnboarded(userId, {
        weight_kg: stats.weight_kg,
        height_cm: stats.height_cm,
        age: stats.age,
        gender: stats.gender as "male" | "female" | "other" | null,
        activity_level: stats.activity_level,
        goal_type: stats.goal_type,
      });
      setProfile(p => p ? {
        ...p,
        weight_kg: stats.weight_kg,
        height_cm: stats.height_cm,
        age: stats.age,
        gender: stats.gender as "male" | "female" | "other" | null,
        activity_level: stats.activity_level,
        goal_type: stats.goal_type,
        onboarded_at: new Date().toISOString(),
      } : p);
    } catch {
      // non-blocking
    }
    setShowOnboarding(false);
  };

  const fetchInsights = async (opts?: { silent?: boolean }) => {
    if (insightsFetchedFor === today) {
      if (!opts?.silent) setShowInsights(true);
      return;
    }
    setInsightsLoading(true);
    if (!opts?.silent) setShowInsights(true);
    setInsightsText("");
    try {
      const last7 = getLast7Days();
      const weekMeals = historyMeals.filter(m => last7.includes(m.meal_date));
      const mealSummary = last7.map(date => {
        const dayMeals = weekMeals.filter(m => m.meal_date === date);
        const isConfirmed = confirmedDates.has(date);
        if (dayMeals.length === 0) return `${date}: no meals logged`;
        if (!isConfirmed) return `${date}: partially logged — exclude from averages`;
        const t = sumMacros(dayMeals);
        return `${date}: ${t.calories} kcal, P:${t.protein}g C:${t.carbs}g F:${t.fat}g (${dayMeals.map(m => m.name).join(", ")})`;
      }).join("\n");

      const statsStr = profile
        ? `User: ${profile.gender ?? "unknown"} gender, ${profile.age ?? "?"} years old, ${profile.weight_kg ?? "?"}kg, ${profile.height_cm ?? "?"}cm. Calorie goal: ${calorieGoal} kcal/day. Goal: ${profile.goal_type ?? "maintain"}.`
        : "No body stats available.";

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "insights",
          text: `${statsStr}\n\nLast 7 days of meals:\n${mealSummary}\n\nGive a short, friendly, personal weekly nutrition summary (3–5 sentences max). Highlight patterns, best day, any concerns, and one actionable tip. Be encouraging and specific.`,
          base64: null, mimeType: null, clarification: null, profileId: userId,
        }),
      }).then(r => r.json());

      const text = res.insights ?? res.error ?? "Couldn't generate insights right now.";
      setInsightsText(text);
      setInsightsFetchedFor(today);
      if (opts?.silent) setShowInsights(true);
    } catch {
      setInsightsText("Couldn't generate insights right now. Try again later.");
      if (opts?.silent) setShowInsights(true);
    } finally {
      setInsightsLoading(false);
    }
  };

  const fetchDietReport = async () => {
    setDietReportLoading(true);
    setShowDietReport(true);
    setDietReportText("");
    try {
      const last7 = getLast7Days();
      const weekMeals = historyMeals.filter(m => last7.includes(m.meal_date));
      const mealSummary = last7.map(date => {
        const dayMeals = weekMeals.filter(m => m.meal_date === date);
        const isConfirmed = confirmedDates.has(date);
        if (dayMeals.length === 0) return `${date}: no meals logged`;
        if (!isConfirmed) return `${date}: partially logged — exclude from averages`;
        const t = sumMacros(dayMeals);
        return `${date}: ${t.calories} kcal, P:${t.protein}g C:${t.carbs}g F:${t.fat}g (${dayMeals.map(m => m.name).join(", ")})`;
      }).join("\n");
      const statsStr = profile
        ? `Goal: ${profile.goal_type ?? "maintain"}. Activity: ${profile.activity_level ?? "moderate"}. ${profile.gender ?? ""} ${profile.age ?? ""}yo, ${profile.weight_kg ?? "?"}kg, ${profile.height_cm ?? "?"}cm. Calorie goal: ${calorieGoal} kcal/day. Protein goal: ${proteinGoal}g/day.`
        : "No body stats available.";
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "insights",
          text: `${statsStr}\n\nLast 7 days:\n${mealSummary}\n\nWrite a structured diet analysis report with these sections:\n1. 📊 Weekly summary (calories vs goal, protein, patterns)\n2. ✅ What's working well\n3. ⚠️ Areas to improve\n4. 🎯 3 specific actionable recommendations for this person's goal (${profile?.goal_type ?? "maintain"})\n\nBe specific, data-driven, and encouraging. 150-200 words max.`,
          base64: null, mimeType: null, clarification: null, profileId: userId,
        }),
      }).then(r => r.json());
      setDietReportText(res.insights ?? res.error ?? "Couldn't generate report right now.");
    } catch {
      setDietReportText("Couldn't generate report right now. Try again later.");
    } finally {
      setDietReportLoading(false);
    }
  };

  const handleMealFeedback = async () => {
    if (!feedbackMeal || !mealFeedbackText.trim()) return;
    setMealFeedbackSaving(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "text",
          text: `${feedbackMeal.name}. User correction: ${mealFeedbackText.trim()}`,
          base64: null, mimeType: null, clarification: null, profileId: userId,
        }),
      }).then(r => r.json());
      if (!res.error && !res.needsClarification) {
        await handleUpdateMeal(feedbackMeal.id, {
          calories: res.calories, protein: res.protein, carbs: res.carbs, fat: res.fat,
          serving_size: res.serving_size ?? feedbackMeal.serving_size,
          name: res.name ?? feedbackMeal.name,
          notes: `${feedbackMeal.name} — corrected: ${mealFeedbackText.trim()}`,
        });
      }
      setFeedbackMeal(null);
      setMealFeedbackText("");
    } catch {
      setFeedbackMeal(null);
    } finally {
      setMealFeedbackSaving(false);
    }
  };

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    return result;
  };

  const scheduleNotification = (time: string) => {
    lsSet(`caloriq-notif-time-${userId}`, time);
    setNotifTime(time);
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SCHEDULE_DAILY_REMINDER",
        time,
        userId,
        title: "Don't forget to log! 🍽️",
        body: "Tap to log your meals and keep your streak going.",
      });
    }
  };

  const handleEnableNotifications = async () => {
    const perm = await requestNotifPermission();
    if (perm === "granted") {
      scheduleNotification(notifTime);
    }
  };

  const handleSignOut = async () => {
    const { supabase: sb } = await import("@/lib/supabase");
    await sb.auth.signOut();
    router.push("/");
  };

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      lsSet("caloriq-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      lsSet("caloriq-theme", "light");
    }
  };

  const toggleRollover = () => {
    const next = !rolloverEnabled;
    setRolloverEnabled(next);
    lsSet(`caloriq-rollover-${userId}`, String(next));
  };

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

  const [upgrading, setUpgrading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleManageSubscription = async () => {
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: userId }),
      }).then(r => r.json());
      if (res.url) {
        window.location.href = res.url;
      } else {
        window.location.href = "https://billing.stripe.com/p/login/14A6oA8ILaui26P8Zu3ks00";
      }
    } catch {
      window.location.href = "https://billing.stripe.com/p/login/14A6oA8ILaui26P8Zu3ks00";
    }
  };

  const handleSaveBodyStats = async () => {
    setSavingStats(true);
    try {
      const { updateBodyStats } = await import("@/lib/db");
      await updateBodyStats(userId, {
        weight_kg: bodyStats.weight_kg ? parseFloat(bodyStats.weight_kg) : null,
        height_cm: bodyStats.height_cm ? parseFloat(bodyStats.height_cm) : null,
        age: bodyStats.age ? parseInt(bodyStats.age) : null,
        gender: (bodyStats.gender as "male" | "female" | "other") || null,
      });
      const { supabase: sb } = await import("@/lib/supabase");
      await sb.from("profiles").update({
        activity_level: bodyStats.activity_level || null,
        goal_type: bodyStats.goal_type || null,
      }).eq("id", userId);
      setProfile(p => p ? {
        ...p,
        weight_kg: bodyStats.weight_kg ? parseFloat(bodyStats.weight_kg) : null,
        height_cm: bodyStats.height_cm ? parseFloat(bodyStats.height_cm) : null,
        age: bodyStats.age ? parseInt(bodyStats.age) : null,
        gender: (bodyStats.gender as "male" | "female" | "other") || null,
        activity_level: (bodyStats.activity_level as ActivityLevel) || null,
        goal_type: (bodyStats.goal_type as GoalType) || null,
      } : p);
      setShowBodyStats(false);
    } finally {
      setSavingStats(false);
    }
  };

  const handleSendFeedback = async () => {
    if (!feedbackMsg.trim()) return;
    setFeedbackSending(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedbackMsg, profileName: profile?.name }),
      });
      setFeedbackSent(true);
      setFeedbackMsg("");
      setTimeout(() => { setShowFeedback(false); setFeedbackSent(false); }, 2000);
    } catch {
      setFeedbackSent(true);
      setTimeout(() => { setShowFeedback(false); setFeedbackSent(false); }, 2000);
    } finally {
      setFeedbackSending(false);
    }
  };
  const AVATARS = ["🧑","👩","👨","🧔","👱","👩‍🦰","👩‍🦱","🧑‍🦲","👴","👵","🧑‍💻","👩‍⚕️","🧑‍🍳","👩‍🎤","🧑‍🎨"];
  const AVATAR_BGS = ["#EEEDFE","#E1F5EE","#E6F1FB","#FAECE7","#EAF3DE","#FAEEDA","#FBEAF0","#F1EFE8"];

  const handleAvatarChange = async (avatar: string, bg: string) => {
    const { supabase: sb } = await import("@/lib/supabase");
    await sb.from("profiles").update({ avatar, avatar_bg: bg }).eq("id", userId);
    setProfile(p => p ? { ...p, avatar, avatar_bg: bg } : p);
    setShowAvatarPicker(false);
  };

  const [showPromo, setShowPromo] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoSuccess, setPromoSuccess] = useState("");

  const handlePromoCode = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError("");
    setPromoSuccess("");
    try {
      const res = await fetch("/api/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode.trim(), profileId: userId }),
      }).then(r => r.json());
      if (res.success) {
        setPromoSuccess(`🎉 ${res.lifetime ? "Lifetime" : res.duration} Pro access activated!`);
        setTimeout(() => {
          setShowUpgrade(false);
          setProfile(p => p ? { ...p, is_pro: true } : p);
          setPromoCode("");
          setPromoSuccess("");
          setShowPromo(false);
        }, 2000);
      } else {
        setPromoError(res.error ?? "Invalid code. Try again.");
      }
    } catch {
      setPromoError("Something went wrong. Try again.");
    } finally {
      setPromoLoading(false);
    }
  };
  const handleUpgrade = async (plan: "monthly" | "yearly") => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, profileId: userId }),
      }).then(r => r.json());
      if (res.url) window.location.href = res.url;
      else setError("Could not start checkout. Try again.");
    } catch {
      setError("Could not start checkout. Try again.");
    } finally {
      setUpgrading(false);
    }
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
        body: JSON.stringify({ mode, text, base64: b64, mimeType: mime, clarification: clar, profileId: userId }),
      }).then(r => r.json());

      if (result.needsClarification) {
        setClar({ question: result.question, options: result.options ?? [] });
        return;
      }
      if (result.limitReached) {
        setUsageCount(result.usageCount ?? 5);
        setShowUpgrade(true);
        setClar(null);
        return;
      }
      if (result.error) {
        setError(result.error);
        setClar(null);
        return;
      }
      const imgUrl = mode !== "text" && preview ? preview : undefined;
      await handleAddMeal(result, imgUrl, pendingMealType, pendingMealTime);
    } catch (e: any) {
      const msg = e?.message ?? "Could not estimate. Try again.";
      setError(msg.includes("fetch") || !navigator.onLine ? "network error" : msg);
      setClar(null);
    }
    finally { setLoading(false); }
  };

  const startAnalysis = async () => {
    setLoading(true); setError(""); setClar(null); setPendingB64(null); setPendingMime(null);
    pendingImageRef.current = null;
    try {
      let b64: string | null = null, mime: string | null = null;
      if (inputMode !== "text" && pendingFile) {
        const r = await readFileAsBase64(pendingFile);
        b64 = r.base64; mime = r.mimeType;
        pendingImageRef.current = { b64, mime };
        setPendingB64(b64); setPendingMime(mime);
      }
      await runFinal(textInput, inputMode, null, b64, mime);
    } catch (e: any) {
      const msg = e?.message ?? "";
      setError(!navigator.onLine || msg.includes("fetch") ? "network error" : "Something went wrong. Try again.");
      setLoading(false);
    }
  };

  const modeConfig = {
    meal:  { Icon: UtensilsCrossed, label: "Meal photo" },
    label: { Icon: Tag,             label: "Nutrition label" },
    text:  { Icon: Pencil,          label: "Describe it" },
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
    <>
    <NativeResumeHandler />
    <div className="max-w-md mx-auto px-4 pt-4" style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}>

      {showOnboarding && profile && (
        <OnboardingFlow profile={profile} onComplete={handleOnboardingComplete} />
      )}

      {justUpgraded && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 mb-4 flex items-center gap-3">
          <span className="text-2xl">🎉</span>
          <div>
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">You're now Pro!</p>
            <p className="text-xs text-green-600 dark:text-green-500">Unlimited AI analyses unlocked.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="Caloriq" className="w-8 h-8 rounded-xl" />
          <div>
            <h1 className="text-xl font-bold">Caloriq</h1>
            <p className="text-xs text-gray-400 mt-0.5">{todayStr}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowProfileMenu(true)}
            className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-full pl-1 pr-3 py-1">
            {profile!.photo_url ? (
              <img src={profile!.photo_url} alt={profile!.name} className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-base" style={{ background: profile!.avatar_bg }}>{profile!.avatar}</span>
            )}
            <span className="text-sm font-medium">{profile!.name.split(" ")[0]}</span>
          </button>
        </div>
      </div>

      {profile?.is_pro && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 border border-blue-200 dark:border-blue-800">
            ⚡ Pro
          </span>
          <span className="text-xs text-gray-400">Unlimited AI analyses</span>
        </div>
      )}

      {tab === "today" && (
      <>
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-4 mb-3">
          <CalorieRing eaten={totals.calories} goal={calorieGoal} />
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
                style={{ width: `${Math.min((totals.protein / proteinGoal) * 100, 100)}%`, background: "var(--prot)" }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{totals.protein}g / {proteinGoal}g protein</p>
            <MacroRatioBar protein={totals.protein} carbs={totals.carbs} fat={totals.fat} />
            {rolloverCalories > 0 && (
              <p className="text-[10px] text-emerald-500 mt-1.5">+{rolloverCalories} kcal rolled over from yesterday</p>
            )}
            <div className="mt-2 flex items-center gap-1">
              <span className="text-sm">{streak > 1 ? "🔥" : "⭐"}</span>
              <span className="text-xs font-semibold" style={{ color: streak > 1 ? "#f97316" : "#9ca3af" }}>
                {streak > 0 ? `${streak}-day streak` : "Log today to start a streak!"}
              </span>
            </div>
            {totals.calories > 0 && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => setShowShareCard(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  📤 Share
                </button>
                <a href={`/${userId}/nutrition`}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  📊 Nutrition
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-50 dark:bg-zinc-800 rounded-xl px-3 py-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">💧</span>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Water</p>
              <p className="text-xs text-gray-400">{waterGlasses} / 8 glasses</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const next = Math.max(0, waterGlasses - 1);
              setWaterGlasses(next);
              lsSet(`water:${userId}:${today}`, String(next));
            }} className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 flex items-center justify-center text-gray-400 hover:text-gray-600 text-sm font-medium">−</button>
            <div className="flex gap-0.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-2 h-3 rounded-sm" style={{ background: i < waterGlasses ? "#3B82F6" : "#e5e7eb" }} />
              ))}
            </div>
            <button onClick={() => {
              const next = Math.min(8, waterGlasses + 1);
              setWaterGlasses(next);
              lsSet(`water:${userId}:${today}`, String(next));
            }} className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 flex items-center justify-center text-gray-400 hover:text-gray-600 text-sm font-medium">+</button>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => fetchInsights()}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            <span>🧠</span> {insightsFetchedFor === today ? "View weekly insights" : "Get weekly insights"}
          </button>
          <button onClick={fetchDietReport}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            <span>📋</span> Diet report
          </button>
        </div>
      </div>

      <WeeklyCard
        meals={historyMeals}
        calorieGoal={calorieGoal}
        showInsights={showInsights}
        insightsLoading={insightsLoading}
        insightsText={insightsText}
        isSunday={new Date().getDay() === 0}
        confirmedDates={confirmedDates}
        onToggleInsights={() => {
          if (!showInsights) fetchInsights();
          else setShowInsights(false);
        }}
      />

      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
        <div className="flex gap-2 mb-3">
          {(["calories", "protein"] as ChartType[]).map(t => (
            <button key={t} onClick={() => setChartType(t)}
              className="text-xs px-3 py-1 rounded-full capitalize transition-colors"
              style={{ background: chartType === t ? "#f3f4f6" : "transparent", fontWeight: chartType === t ? 600 : 400, color: chartType === t ? "#111" : "#6b7280" }}>
              {t}
            </button>
          ))}
        </div>
        <BarChart meals={meals} type={chartType} onBarClick={() => setShowAnalytics(p => !p)} calorieGoal={calorieGoal} proteinGoal={proteinGoal} />
        {showAnalytics && <AnalyticsTable meals={meals} onClose={() => setShowAnalytics(false)} />}
      </div>

      <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Today's meals</p>
          {todayMeals.length === 0
            ? <div className="text-center py-10 text-gray-400 text-sm">
                No meals yet today.{" "}
                <button onClick={() => setTab("add")} className="text-blue-400">Add one →</button>
              </div>
            : todayMeals.map(m => <MealCard key={m.id} meal={m} onDelete={handleDeleteMeal} onUpdate={handleUpdateMeal} profileId={userId} onFlag={m => { setFeedbackMeal(m); setMealFeedbackText(""); }} />)}
          {todayMeals.length > 0 && (
            <DayLoggedButton confirmed={dayConfirmed} onToggle={toggleDayConfirmed} />
          )}
        </div>
      </>
      )}

      {tab === "add" && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">Add new</p>
          <div className="flex gap-2 mb-4">
            {(Object.entries(modeConfig) as [typeof inputMode, typeof modeConfig[keyof typeof modeConfig]][]).map(([key, cfg]) => {
              const ModeIcon = cfg.Icon;
              const active = inputMode === key;
              return (
              <button key={key} onClick={() => { setInputMode(key); setPreview(null); setPendingFile(null); setClar(null); setError(""); }}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 px-1 text-xs rounded-xl border transition-colors dark:border-zinc-600"
                style={{
                  background: active ? "#ede9ff" : "transparent",
                  fontWeight: active ? 600 : 400,
                  borderColor: active ? "#7F77DD" : undefined,
                  color: active ? "#4f46e5" : "#6b7280",
                }}>
                <ModeIcon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                <span className={active ? "text-indigo-600 dark:text-indigo-400" : ""}>{cfg.label}</span>
              </button>
              );
            })}
          </div>

          <MealTimeEditor
            mealTime={pendingMealTime} mealType={pendingMealType}
            onChange={setPendingMealTime} onTypeChange={setPendingMealType}
          />

          {clarification && !loading && (
            <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-4 mb-4">
              <p className="text-sm font-medium mb-2">One quick question:</p>
              <p className="text-sm mb-3">{clarification.question}</p>
              <div className="space-y-2">
                {clarification.options.map(opt => (
                  <button key={opt} onClick={() => {
                    const img = pendingImageRef.current;
                    runFinal(textInput, inputMode, opt, img?.b64 ?? pendingB64, img?.mime ?? pendingMime);
                  }}
                    className="w-full text-left text-sm px-4 py-2.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-600 rounded-xl hover:bg-gray-50">
                    {opt}
                  </button>
                ))}
                <button onClick={() => {
                  const img = pendingImageRef.current;
                  runFinal(textInput, inputMode, "Not sure, best estimate", img?.b64 ?? pendingB64, img?.mime ?? pendingMime);
                }}
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
                    <div className="flex justify-center mb-2">{(() => { const ModeIcon = modeConfig[inputMode].Icon; return <ModeIcon className="w-10 h-10 text-gray-400" strokeWidth={1.5} />; })()}</div>
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
              {inputMode === "text" && (
                <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                  placeholder="e.g. 'Two scrambled eggs with toast' or 'McDonald's Big Mac meal'" rows={3}
                  className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
              )}
              {inputMode !== "text" && (
                <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
                  placeholder={inputMode === "label"
                    ? "Optional: describe the product or number of servings"
                    : "Optional: describe the meal to improve accuracy"}
                  rows={2}
                  className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-gray-400 resize-none" />
              )}
              <div className="flex gap-2">
                {(preview || textInput.trim()) && (
                  <button onClick={resetAdd}
                    className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">Cancel</button>
                )}
                <button onClick={startAnalysis} disabled={loading || !canSubmit}
                  className="flex-[2] rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#7F77DD,#5b54c4)", color: "#fff" }}>
                  {loading ? loadingMsg : inputMode === "label" ? "Read label" : inputMode === "meal" ? "Analyze photo" : "Search & estimate"}
                </button>
              </div>
            </div>
          )}

          {loading && <p className="text-center text-sm text-gray-400 mt-3">⏳ {loadingMsg}</p>}
          {error && (() => {
            const { emoji, message, hint } = friendlyError(error);
            return (
              <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">{message}</p>
                  <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">{hint}</p>
                </div>
                <button onClick={startAnalysis} disabled={!canSubmit}
                  className="flex-shrink-0 text-xs bg-red-100 dark:bg-red-800 text-red-600 dark:text-red-300 px-3 py-1.5 rounded-xl font-medium hover:bg-red-200 dark:hover:bg-red-700 transition-colors disabled:opacity-40">
                  Retry
                </button>
              </div>
            );
          })()}

          <div className="mt-6">
            <p className="text-xs font-medium text-gray-400 mb-2">Recent foods</p>
            <FoodSearch meals={historyMeals.length > 0 ? historyMeals : meals} onRelog={handleRelog} userId={userId} />
          </div>
        </div>
      )}

      {tab === "history" && (() => {
        const grouped = historyMeals.reduce<Record<string, Meal[]>>((acc, m) => {
          acc[m.meal_date] = acc[m.meal_date] || []; acc[m.meal_date].push(m); return acc;
        }, {});
        return (
          <div>
            <button onClick={async () => { const all = await getAllMeals(userId); exportMealsCSV(all, profile!.name); }}
              className="w-full flex items-center justify-center gap-2 mb-3 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
              <span>📥</span> Export my food log (CSV)
            </button>
            <p className="text-xs text-gray-400 text-center mb-4">
              Your data belongs to you — export it anytime.
            </p>
            {Object.keys(grouped).length === 0
              ? <div className="text-center py-10 text-gray-400 text-sm">No history yet.</div>
              : Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dayMeals]) => {
                  const dt = sumMacros(dayMeals);
                  const isDateToday = date === today;
                  const dateConfirmed = isDateToday
                    ? dayConfirmed
                    : lsGet(`dayConfirmed:${userId}:${date}`) === "true";
                  const toggleDateConfirmed = () => {
                    if (isDateToday) { toggleDayConfirmed(); return; }
                    const cur = lsGet(`dayConfirmed:${userId}:${date}`);
                    if (cur === "true") lsRemove(`dayConfirmed:${userId}:${date}`);
                    else lsSet(`dayConfirmed:${userId}:${date}`, "true");
                    setMeals(prev => [...prev]);
                  };
                  return (
                    <div key={date} className="mb-5">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{fmtShort(date)}</p>
                        <p className="text-xs text-gray-400">
                          <span className="font-medium" style={{ color: "var(--cal)" }}>{dt.calories}</span> kcal ·{" "}
                          P: <span style={{ color: "var(--prot)" }}>{dt.protein}g</span> · C: {dt.carbs}g · F: {dt.fat}g
                        </p>
                      </div>
                      {dayMeals.map(m => <MealCard key={m.id} meal={m} onDelete={handleDeleteMeal} onUpdate={handleUpdateMeal} profileId={userId} onFlag={m => { setFeedbackMeal(m); setMealFeedbackText(""); }} />)}
                      <DayLoggedButton confirmed={dateConfirmed} onToggle={toggleDateConfirmed} isToday={isDateToday} />
                    </div>
                  );
                })}
          </div>
        );
      })()}

      {showFeedback && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="font-medium text-sm">Send us a message</p>
              <button onClick={() => setShowFeedback(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {feedbackSent ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">🙏</div>
                <p className="text-sm font-medium">Thanks for your feedback!</p>
                <p className="text-xs text-gray-400 mt-1">We read every message.</p>
              </div>
            ) : (
              <>
                <textarea
                  value={feedbackMsg}
                  onChange={e => setFeedbackMsg(e.target.value)}
                  placeholder="Share your thoughts, ideas, or report a problem…"
                  rows={5}
                  className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none focus:border-gray-400 resize-none mb-3"
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowFeedback(false)}
                    className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">
                    Cancel
                  </button>
                  <button onClick={handleSendFeedback} disabled={feedbackSending || !feedbackMsg.trim()}
                    className="flex-[2] bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
                    {feedbackSending ? "Sending…" : "Send message"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showAvatarPicker && !profile?.photo_url && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="font-medium text-sm">Choose your avatar</p>
              <button onClick={() => setShowAvatarPicker(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {AVATARS.map((a, i) => (
                <button key={a} onClick={() => handleAvatarChange(a, AVATAR_BGS[i % AVATAR_BGS.length])}
                  className="w-12 h-12 rounded-full text-2xl flex items-center justify-center transition-all border-2"
                  style={{
                    background: AVATAR_BGS[i % AVATAR_BGS.length],
                    borderColor: profile?.avatar === a ? "#888" : "transparent"
                  }}>{a}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showShareCard && (
        <ShareDaySummaryCard
          name={profile?.name ?? ""}
          date={today}
          calories={totals.calories}
          calorieGoal={calorieGoal}
          protein={totals.protein}
          carbs={totals.carbs}
          fat={totals.fat}
          streak={streak}
          onClose={() => setShowShareCard(false)}
        />
      )}

      {showUpgrade && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">🚀</div>
              <h2 className="text-xl font-bold mb-1">You've hit your daily limit</h2>
              <p className="text-sm text-gray-400">
                You've used all {usageCount} free AI analyses today. Upgrade to Pro for unlimited analyses!
              </p>
            </div>
            <div className="space-y-3 mb-4">
              <button onClick={() => handleUpgrade("monthly")}
                className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl p-3 flex justify-between items-center hover:bg-gray-100 transition-colors">
                <div className="text-left">
                  <p className="text-sm font-semibold">Pro Monthly</p>
                  <p className="text-xs text-gray-400">Unlimited AI analyses</p>
                </div>
                <p className="text-lg font-bold text-blue-500">$0.49<span className="text-xs font-normal text-gray-400">/mo</span></p>
              </button>
              <button onClick={() => handleUpgrade("yearly")}
                className="w-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex justify-between items-center hover:bg-blue-100 transition-colors">
                <div className="text-left">
                  <p className="text-sm font-semibold">Pro Yearly <span className="text-xs text-green-500 font-medium">Save 15%</span></p>
                  <p className="text-xs text-gray-400">Best value — less than a coffee</p>
                </div>
                <p className="text-lg font-bold text-blue-500">$4.99<span className="text-xs font-normal text-gray-400">/yr</span></p>
              </button>
            </div>
            {!showPromo ? (
              <div className="space-y-2">
                <button onClick={() => setShowPromo(true)}
                  className="w-full py-2 text-sm text-blue-400 hover:text-blue-600">
                  Have a promo code?
                </button>
                <button onClick={() => setShowUpgrade(false)}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
                  Maybe later — resets tomorrow
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value.toUpperCase().trim())}
                    onKeyDown={e => e.key === "Enter" && handlePromoCode()}
                    placeholder="Enter promo code"
                    className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-blue-400 uppercase tracking-widest"
                  />
                  <button onClick={handlePromoCode} disabled={promoLoading || !promoCode.trim()}
                    className="bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40">
                    {promoLoading ? "…" : "Apply"}
                  </button>
                </div>
                {promoError && <p className="text-red-500 text-xs text-center">{promoError}</p>}
                {promoSuccess && <p className="text-green-500 text-xs text-center">{promoSuccess}</p>}
                <button onClick={() => { setShowPromo(false); setPromoError(""); setPromoCode(""); }}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showNotifSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="font-medium text-sm">🔔 Logging reminder</p>
              <button onClick={() => setShowNotifSettings(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {notifPermission === "denied" ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 mb-2">Notifications are blocked in your browser settings.</p>
                <p className="text-xs text-gray-400">To enable, open your browser/phone settings and allow notifications for this site.</p>
              </div>
            ) : notifPermission === "granted" ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Daily reminder is active. Pick the time you want to be nudged:</p>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Reminder time</label>
                  <input
                    type="time"
                    value={notifTime}
                    onChange={e => setNotifTime(e.target.value)}
                    className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowNotifSettings(false)}
                    className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">Cancel</button>
                  <button onClick={() => { scheduleNotification(notifTime); setShowNotifSettings(false); }}
                    className="flex-[2] bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl py-2.5 text-sm font-medium">
                    Save reminder
                  </button>
                </div>
                <button onClick={() => {
                  lsRemove(`caloriq-notif-time-${userId}`);
                  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: "CANCEL_REMINDER", userId });
                  }
                  setNotifPermission("default");
                  setShowNotifSettings(false);
                }} className="w-full py-2 text-xs text-red-400 hover:text-red-600">
                  Turn off reminders
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Get a daily nudge to log your meals at a time that works for you.</p>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Reminder time</label>
                  <input
                    type="time"
                    value={notifTime}
                    onChange={e => setNotifTime(e.target.value)}
                    className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowNotifSettings(false)}
                    className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">Cancel</button>
                  <button onClick={async () => { await handleEnableNotifications(); setShowNotifSettings(false); }}
                    className="flex-[2] bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-medium">
                    Enable reminders 🔔
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showBodyStats && (() => {
        const weightDisplay = useImperial && bodyStats.weight_kg
          ? String(Math.round(parseFloat(bodyStats.weight_kg) * 2.2046 * 10) / 10)
          : bodyStats.weight_kg;
        const heightKg = bodyStats.height_cm ? parseFloat(bodyStats.height_cm) : 0;
        const heightFt = useImperial ? Math.floor(heightKg / 30.48) : 0;
        const heightIn = useImperial ? Math.round((heightKg / 2.54) % 12) : 0;
        const heightDisplay = useImperial && bodyStats.height_cm ? String(heightFt) : bodyStats.height_cm;
        const heightInDisplay = useImperial && bodyStats.height_cm ? String(heightIn) : "";
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 max-w-sm w-full shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <p className="font-medium text-sm">My stats</p>
                <div className="flex items-center gap-2">
                  <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5 text-xs">
                    <button onClick={() => setUseImperial(false)}
                      className="px-2 py-1 rounded-md transition-all"
                      style={{ background: !useImperial ? "#fff" : "transparent", fontWeight: !useImperial ? 600 : 400, color: !useImperial ? "#111" : "#6b7280" }}>
                      kg/cm
                    </button>
                    <button onClick={() => setUseImperial(true)}
                      className="px-2 py-1 rounded-md transition-all"
                      style={{ background: useImperial ? "#fff" : "transparent", fontWeight: useImperial ? 600 : 400, color: useImperial ? "#111" : "#6b7280" }}>
                      lbs/ft
                    </button>
                  </div>
                  <button onClick={() => setShowBodyStats(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">Help us calculate your ideal calorie and protein goals.</p>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Weight ({useImperial ? "lbs" : "kg"})</label>
                    <input type="number" value={weightDisplay}
                      onChange={e => {
                        const val = e.target.value;
                        const kg = useImperial ? String(Math.round(parseFloat(val) / 2.2046 * 10) / 10) : val;
                        setBodyStats((s: typeof bodyStats) => ({...s, weight_kg: kg}));
                      }}
                      placeholder={useImperial ? "154" : "70"}
                      className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Height ({useImperial ? "ft" : "cm"})</label>
                    {useImperial ? (
                      <div className="flex gap-1">
                        <input type="number" value={heightDisplay}
                          onChange={e => {
                            const ft = parseFloat(e.target.value) || 0;
                            const cm = String(Math.round((ft * 30.48) + (heightIn * 2.54)));
                            setBodyStats((s: typeof bodyStats) => ({...s, height_cm: cm}));
                          }}
                          placeholder="5"
                          className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none" />
                        <input type="number" value={heightInDisplay}
                          onChange={e => {
                            const inches = parseFloat(e.target.value) || 0;
                            const cm = String(Math.round((heightFt * 30.48) + (inches * 2.54)));
                            setBodyStats((s: typeof bodyStats) => ({...s, height_cm: cm}));
                          }}
                          placeholder="in"
                          className="w-16 border border-gray-200 dark:border-zinc-600 rounded-xl px-2 py-2 text-sm bg-transparent outline-none" />
                      </div>
                    ) : (
                      <input type="number" value={bodyStats.height_cm}
                        onChange={e => setBodyStats((s: typeof bodyStats) => ({...s, height_cm: e.target.value}))}
                        placeholder="175"
                        className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none" />
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Age</label>
                    <input type="number" value={bodyStats.age} onChange={e => setBodyStats((s: typeof bodyStats) => ({...s, age: e.target.value}))}
                      placeholder="30" className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Gender</label>
                    <select value={bodyStats.gender} onChange={e => setBodyStats((s: typeof bodyStats) => ({...s, gender: e.target.value}))}
                      className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none">
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Activity level</label>
                    <select value={bodyStats.activity_level} onChange={e => setBodyStats((s: typeof bodyStats) => ({...s, activity_level: e.target.value}))}
                      className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none">
                      <option value="">Select</option>
                      <option value="sedentary">🪑 Sedentary</option>
                      <option value="light">🚶 Light</option>
                      <option value="moderate">🏃 Moderate</option>
                      <option value="active">💪 Active</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">My goal</label>
                    <select value={bodyStats.goal_type} onChange={e => setBodyStats((s: typeof bodyStats) => ({...s, goal_type: e.target.value}))}
                      className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none">
                      <option value="">Select</option>
                      <option value="lose">📉 Lose weight</option>
                      <option value="maintain">⚖️ Maintain</option>
                      <option value="gain">📈 Build muscle</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowBodyStats(false)}
                  className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">Cancel</button>
                <button onClick={handleSaveBodyStats} disabled={savingStats}
                  className="flex-[2] bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
                  {savingStats ? "Saving…" : "Save stats"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showForgotNudge && (
        <div className="fixed left-4 right-4 z-40 max-w-md mx-auto" style={{ bottom: 'calc(80px + env(safe-area-inset-bottom) + 0.5rem)' }}>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3">
            <span className="text-xl flex-shrink-0">🍽️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-white">Did you forget to log?</p>
              <p className="text-xs text-gray-400">Looks like you haven't logged anything in a while.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => { setTab("add"); setShowForgotNudge(false); lsSet(`nudge:${userId}:${today}`, "1"); }}
                className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded-xl font-medium">Log now</button>
              <button onClick={() => { setShowForgotNudge(false); lsSet(`nudge:${userId}:${today}`, "1"); }}
                className="text-xs text-gray-400 px-2 py-1.5">✕</button>
            </div>
          </div>
        </div>
      )}

      {feedbackMeal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Calories seem off? 🚩</p>
              <button onClick={() => setFeedbackMeal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="text-xs text-gray-400 mb-1">Original: <span className="font-medium text-gray-600 dark:text-gray-300">{feedbackMeal.name}</span> — {feedbackMeal.calories} kcal</p>
            <p className="text-xs text-gray-400 mb-3">Tell us what was different and we'll re-analyze:</p>
            <textarea
              value={mealFeedbackText}
              onChange={e => setMealFeedbackText(e.target.value)}
              placeholder="e.g. 'It was a double portion' or 'No butter was used' or 'It was a small serving'"
              rows={3}
              className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm bg-transparent outline-none focus:border-indigo-400 resize-none mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setFeedbackMeal(null)}
                className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">Cancel</button>
              <button onClick={handleMealFeedback} disabled={mealFeedbackSaving || !mealFeedbackText.trim()}
                className="flex-[2] bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
                {mealFeedbackSaving ? "Re-analyzing…" : "Re-analyze ✨"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDietReport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-zinc-800">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">📋 My diet report</p>
              <button onClick={() => setShowDietReport(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-5 py-4 max-h-96 overflow-y-auto">
              {dietReportLoading ? (
                <div className="flex flex-col items-center gap-3 py-8 text-gray-400">
                  <span className="text-3xl animate-pulse">📊</span>
                  <p className="text-sm">Analyzing your week…</p>
                </div>
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{dietReportText}</p>
              )}
            </div>
            {!dietReportLoading && (
              <div className="px-5 pb-4">
                <button onClick={fetchDietReport}
                  className="w-full border border-gray-200 dark:border-zinc-700 rounded-xl py-2 text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  🔄 Regenerate
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showRolloverPrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Calorie rollover 🔄</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              If you finish a day under your calorie goal, would you like to carry up to 20% of unused calories into the next day?
            </p>
            <div className="flex gap-3">
              <button onClick={() => {
                lsSet(`caloriq-rollover-${userId}`, "true");
                setRolloverEnabled(true);
                setShowRolloverPrompt(false);
              }} className="flex-1 bg-emerald-500 text-white rounded-xl py-3 text-sm font-medium">
                Yes, roll it over
              </button>
              <button onClick={() => setShowRolloverPrompt(false)}
                className="flex-1 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 rounded-xl py-3 text-sm font-medium">
                No thanks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW — Profile bottom-sheet menu (FIX #2) */}
      {showProfileMenu && profile && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowProfileMenu(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-t-3xl w-full max-w-md mx-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-gray-200 dark:bg-zinc-700 rounded-full" /></div>

            <div className="flex items-center gap-3 px-6 pt-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
              <button onClick={() => { if (!profile.photo_url) { setShowProfileMenu(false); setShowAvatarPicker(true); } }} className="flex-shrink-0">
                {profile.photo_url ? (
                  <img src={profile.photo_url} alt="" className="w-12 h-12 rounded-2xl object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: profile.avatar_bg }}>{profile.avatar}</div>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{profile.name}</p>
                {profile.is_pro
                  ? <span className="text-xs text-blue-500 font-medium">⚡ Pro member</span>
                  : <span className="text-xs text-gray-400">Free plan</span>}
              </div>
              <button onClick={() => setShowProfileMenu(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="py-2 max-h-[60vh] overflow-y-auto">
              <MenuItem icon={User} label="My account" onClick={() => { setShowProfileMenu(false); router.push('/account'); }} />
              <MenuItem icon={Scale} label="My stats" onClick={() => {
                setBodyStats({
                  weight_kg: String(profile?.weight_kg ?? ""),
                  height_cm: String(profile?.height_cm ?? ""),
                  age: String(profile?.age ?? ""),
                  gender: profile?.gender ?? "",
                  activity_level: profile?.activity_level ?? "",
                  goal_type: profile?.goal_type ?? "",
                });
                setShowProfileMenu(false);
                setShowBodyStats(true);
              }} />
              <MenuItem icon={BarChart3} label="Nutrition details" onClick={() => { setShowProfileMenu(false); router.push(`/${userId}/nutrition`); }} />
              <MenuItem icon={Bell} label={notifPermission === 'granted' ? 'Reminder set' : 'Set reminder'} onClick={() => { setShowProfileMenu(false); setShowNotifSettings(true); }} />
              <MenuItem icon={isDark ? Sun : Moon} label={isDark ? "Light mode" : "Dark mode"} onClick={toggleDark}
                right={<div className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0" style={{ background: isDark ? "#7F77DD" : "#e5e7eb" }}><div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform" style={{ transform: isDark ? "translateX(18px)" : "translateX(2px)" }} /></div>} />
              <MenuItem icon={RefreshCw} label="Calorie rollover" onClick={toggleRollover}
                right={<div className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0" style={{ background: rolloverEnabled ? "#10B981" : "#e5e7eb" }}><div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform" style={{ transform: rolloverEnabled ? "translateX(18px)" : "translateX(2px)" }} /></div>} />
              {profile.is_pro && (<MenuItem icon={CreditCard} label="Manage subscription" onClick={() => { setShowProfileMenu(false); handleManageSubscription(); }} />)}
              {!profile.is_pro && (<MenuItem icon={CreditCard} label="Upgrade to Pro" onClick={() => { setShowProfileMenu(false); setShowUpgrade(true); }} />)}
              <MenuItem icon={MessageSquare} label="Send feedback" onClick={() => { setShowProfileMenu(false); setShowFeedback(true); }} />
            </div>

            <div className="border-t border-gray-100 dark:border-zinc-800 py-2">
              <MenuItem icon={Shield} label="Privacy" onClick={() => { setShowProfileMenu(false); router.push('/privacy'); }} />
              <MenuItem icon={FileText} label="Terms" onClick={() => { setShowProfileMenu(false); router.push('/terms'); }} />
              <MenuItem icon={LogOut} label="Sign out" onClick={handleSignOut} danger />
            </div>
          </div>
        </div>
      )}

    </div>

    {/* NEW — Fixed bottom navigation */}
    <nav className="fixed bottom-0 inset-x-0 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-md mx-auto h-16 grid grid-cols-5 items-center px-2">
        <NavButton icon={HomeIcon}    label="Today"   active={tab === "today"}   onClick={() => setTab("today")} />
        <NavButton icon={HistoryIcon} label="History" active={tab === "history"} onClick={() => setTab("history")} />
        <div className="flex justify-center">
          <button onClick={() => { resetAdd(); setTab("add"); }}
            className="w-14 h-14 -translate-y-3 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
            style={{ background: "linear-gradient(135deg,#7F77DD,#5b54c4)" }}
            aria-label="Add meal">
            <Plus className="w-7 h-7 text-white" strokeWidth={2.5} />
          </button>
        </div>
        <NavButton icon={BarChart3} label="Stats"   onClick={() => router.push(`/${userId}/nutrition`)} />
        <NavButton icon={User}      label="Profile" active={showProfileMenu} onClick={() => setShowProfileMenu(p => !p)} />
      </div>
    </nav>
    </>
  );
}