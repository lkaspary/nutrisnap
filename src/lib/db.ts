import { supabase } from "./supabase";
export type Profile = { id:string; name:string; avatar:string; avatar_bg:string; created_at:string; };
export type Meal = {
  id:string; profile_id:string; name:string;
  calories:number; protein:number; carbs:number; fat:number;
  source?:string; confidence?:string; notes?:string;
  serving_size?:string; image_url?:string|null;
  meal_date:string; logged_at:string;
};
export async function getProfiles(): Promise<Profile[]> {
  const {data,error} = await supabase.from("profiles").select("*").order("created_at");
  if (error) throw error; return data??[];
}
export async function createProfile(p:Omit<Profile,"id"|"created_at">): Promise<Profile> {
  const {data,error} = await supabase.from("profiles").insert(p).select().single();
  if (error) throw error; return data;
}
export async function deleteProfile(id:string): Promise<void> {
  const {error} = await supabase.from("profiles").delete().eq("id",id);
  if (error) throw error;
}
export async function getMeals(profileId:string): Promise<Meal[]> {
  const {data,error} = await supabase.from("meals").select("*")
    .eq("profile_id",profileId).order("logged_at",{ascending:false});
  if (error) throw error; return data??[];
}
export async function addMeal(meal:Omit<Meal,"id"|"logged_at">): Promise<Meal> {
  const {data,error} = await supabase.from("meals").insert(meal).select().single();
  if (error) throw error; return data;
}
export async function deleteMeal(id:string): Promise<void> {
  const {error} = await supabase.from("meals").delete().eq("id",id);
  if (error) throw error;
}
export async function updateMeal(id:string, updates:Partial<Omit<Meal,"id"|"profile_id"|"logged_at">>): Promise<void> {
  const {error} = await supabase.from("meals").update(updates).eq("id",id);
  if (error) throw error;
}