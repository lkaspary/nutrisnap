import { supabase } from "@/lib/supabase";
const createClient = () => supabase;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Profile {
  id: string;
  name: string;
  avatar: string;
  avatar_bg: string;
  created_at: string;
}

export type MealType = "breakfast" | "lunch" | "snack" | "dinner";

export interface Meal {
  id: string;
  profile_id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
  confidence: string;
  notes: string;
  serving_size: string;
  image_url: string | null;
  meal_date: string;          // YYYY-MM-DD
  meal_type: MealType;        // breakfast | lunch | snack | dinner
  meal_time: string;          // ISO timestamp
  logged_at: string;          // ISO timestamp (set by DB)
}

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function getProfiles(): Promise<Profile[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, name, avatar, avatar_bg, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createProfile(p: Omit<Profile, "id" | "created_at">): Promise<Profile> {
  const sb = createClient();
  const { data, error } = await sb.from("profiles").insert(p).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProfile(id: string): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("profiles").delete().eq("id", id);
  if (error) throw error;
}

// ── Meals ─────────────────────────────────────────────────────────────────────
export async function getMeals(profileId: string): Promise<Meal[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("meals")
    .select(
      "id, profile_id, name, calories, protein, carbs, fat, source, confidence, notes, serving_size, meal_date, meal_type, meal_time, logged_at"
    )
    .eq("profile_id", profileId)
    .order("logged_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map(normalise);
}

export async function getMealsSince(profileId: string, since: string): Promise<Meal[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("meals")
    .select(
      "id, profile_id, name, calories, protein, carbs, fat, source, confidence, notes, serving_size, meal_date, meal_type, meal_time, logged_at"
    )
    .eq("profile_id", profileId)
    .lt("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map(normalise);
}

export async function addMeal(
  meal: Omit<Meal, "id" | "logged_at">
): Promise<Meal> {
  const sb = createClient();
  const { data, error } = await sb.from("meals").insert(meal).select().single();
  if (error) throw error;
  return normalise(data);
}

export async function updateMealDate(id: string, meal_date: string): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("meals").update({ meal_date }).eq("id", id);
  if (error) throw error;
}

export async function deleteMeal(id: string): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("meals").delete().eq("id", id);
  if (error) throw error;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Backfill sensible defaults for rows that predate the new columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(row: any): Meal {
  return {
    ...row,
    meal_type: (row.meal_type ?? "snack") as MealType,
    meal_time: (row.meal_time ?? row.logged_at) as string,
  };
}