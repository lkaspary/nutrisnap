export const DAILY_GOAL = 2400;
export const PROTEIN_GOAL = 190;

// Activity multipliers for Mifflin-St Jeor
const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light:     1.375,
  moderate:  1.55,
  active:    1.725,
};

// Goal adjustments: lose = -300 kcal, maintain = 0, gain = +300 kcal
const GOAL_ADJUSTMENTS: Record<string, number> = {
  lose:     -300,
  maintain:  0,
  gain:     +300,
};

// #30 — Calculate personalized calorie goal from body stats using Mifflin-St Jeor BMR
// Returns null if insufficient data, falls back to DAILY_GOAL in the UI
export function calcCalorieGoal(stats: {
  weight_kg: number | null;
  height_cm: number | null;
  age: number | null;
  gender: string | null;
  activity_level?: string | null;
  goal_type?: string | null;
}): number | null {
  const { weight_kg, height_cm, age, gender } = stats;
  if (!weight_kg || !height_cm || !age || !gender) return null;
  // Mifflin-St Jeor
  const bmr =
    gender === "male"
      ? 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
      : 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
  const multiplier = ACTIVITY_MULTIPLIERS[stats.activity_level ?? "moderate"] ?? 1.55;
  const adjustment = GOAL_ADJUSTMENTS[stats.goal_type ?? "maintain"] ?? 0;
  return Math.round((bmr * multiplier + adjustment) / 50) * 50;
}

// #30 — Protein goal: 1g per lb of bodyweight, or fallback
export function calcProteinGoal(weight_kg: number | null): number {
  if (!weight_kg) return PROTEIN_GOAL;
  return Math.round(weight_kg * 2.2);
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getLast7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  });
}

export function sumMacros(meals: { calories: number; protein: number; carbs: number; fat: number }[]) {
  return meals.reduce(
    (a, m) => ({ calories: a.calories + m.calories, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function fmtShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function fmtMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function getWeekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  const wy = dt.getFullYear();
  const wm = String(dt.getMonth() + 1).padStart(2, "0");
  const wd = String(dt.getDate()).padStart(2, "0");
  return `${wy}-${wm}-${wd}`;
}