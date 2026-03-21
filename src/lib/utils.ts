import { Meal } from "./db";
export const DAILY_GOAL = 2000;
export const PROTEIN_GOAL = 150;
export type Macros = { calories:number; protein:number; carbs:number; fat:number };
export function sumMacros(meals:Meal[]): Macros {
  return meals.reduce((a,m)=>({calories:a.calories+m.calories,protein:a.protein+m.protein,carbs:a.carbs+m.carbs,fat:a.fat+m.fat}),{calories:0,protein:0,carbs:0,fat:0});
}
export function todayISO() { return new Date().toISOString().split("T")[0]; }
export function getLast7Days(): string[] {
  return Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().split("T")[0];});
}
export function fmtShort(iso:string) { return new Date(iso+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
export function fmtWeek(iso:string) { const d=new Date(iso+"T00:00:00"),end=new Date(d);end.setDate(end.getDate()+6);return fmtShort(iso)+"–"+fmtShort(end.toISOString().split("T")[0]); }
export function fmtMonth(iso:string) { return new Date(iso+"T00:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"}); }
export function getWeekStart(iso:string) { const d=new Date(iso+"T00:00:00");d.setDate(d.getDate()-d.getDay());return d.toISOString().split("T")[0]; }
