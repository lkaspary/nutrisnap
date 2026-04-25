import { supabase } from "@/lib/supabase";
const createClient = () => supabase;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Profile {
  id: string;
  user_id: string | null;
  name: string;
  avatar: string;
  avatar_bg: string;
  photo_url: string | null;
  created_at: string;
  is_pro: boolean;
  stripe_customer_id: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  age: number | null;
  gender: "male" | "female" | "other" | null;
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
  meal_date: string;
  meal_type: MealType;
  meal_time: string;
  logged_at: string;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function getProfiles(): Promise<Profile[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, user_id, name, avatar, avatar_bg, photo_url, created_at, is_pro, stripe_customer_id, weight_kg, height_cm, age, gender")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(p => ({
    ...p,
    user_id: p.user_id ?? null,
    photo_url: p.photo_url ?? null,
    is_pro: p.is_pro ?? false,
    stripe_customer_id: p.stripe_customer_id ?? null,
    weight_kg: p.weight_kg ?? null,
    height_cm: p.height_cm ?? null,
    age: p.age ?? null,
    gender: p.gender ?? null,
  }));
}

export async function createProfile(p: Omit<Profile, "id" | "created_at" | "is_pro" | "stripe_customer_id">): Promise<Profile> {
  const sb = createClient();
  const { data, error } = await sb.from("profiles").insert(p).select().single();
  if (error) throw error;
  return {
    ...data,
    user_id: data.user_id ?? null,
    photo_url: data.photo_url ?? null,
    is_pro: data.is_pro ?? false,
    stripe_customer_id: data.stripe_customer_id ?? null,
  };
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

// Get last 30 days of meals for history view (#16)
export async function getMeals30Days(profileId: string): Promise<Meal[]> {
  const sb = createClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await sb
    .from("meals")
    .select(
      "id, profile_id, name, calories, protein, carbs, fat, source, confidence, notes, serving_size, meal_date, meal_type, meal_time, logged_at"
    )
    .eq("profile_id", profileId)
    .gte("meal_date", since.toISOString().split("T")[0])
    .order("logged_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalise);
}

// Get ALL meals for full CSV export (#14)
export async function getAllMeals(profileId: string): Promise<Meal[]> {
  const sb = createClient();
  const allMeals: Meal[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("meals")
      .select(
        "id, profile_id, name, calories, protein, carbs, fat, source, confidence, notes, serving_size, meal_date, meal_type, meal_time, logged_at"
      )
      .eq("profile_id", profileId)
      .order("logged_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allMeals.push(...data.map(normalise));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allMeals;
}

// Add weight/height/age profile fields (#19)
export interface BodyStats {
  weight_kg: number | null;
  height_cm: number | null;
  age: number | null;
  gender: "male" | "female" | "other" | null;
}

export async function updateBodyStats(profileId: string, stats: BodyStats): Promise<void> {
  const sb = createClient();
  const { error } = await sb
    .from("profiles")
    .update(stats)
    .eq("id", profileId);
  if (error) throw error;
}

export async function addMeal(meal: Omit<Meal, "id" | "logged_at">): Promise<Meal> {
  const sb = createClient();
  const { data, error } = await sb.from("meals").insert(meal).select().single();
  if (error) throw error;
  return normalise(data);
}

export async function updateMeal(
  id: string,
  updates: Partial<Pick<Meal, "meal_date" | "meal_type" | "meal_time" | "notes" | "name" | "calories" | "protein" | "carbs" | "fat" | "serving_size">>
): Promise<Meal> {
  const sb = createClient();
  const { data, error } = await sb
    .from("meals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return normalise(data);
}

export async function deleteMeal(id: string): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("meals").delete().eq("id", id);
  if (error) throw error;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(row: any): Meal {
  return {
    ...row,
    meal_type: (row.meal_type ?? "snack") as MealType,
    meal_time: (row.meal_time ?? row.logged_at) as string,
  };
}