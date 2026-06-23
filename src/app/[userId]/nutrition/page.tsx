import NutritionPage from "./NutritionPage";
export async function generateStaticParams() { return [{ userId: "_" }]; }
export default function Page() { return <NutritionPage />; }
