import { Suspense } from "react";
import TrackerPage from "./TrackerPage";
export async function generateStaticParams() { return [{ userId: "_" }]; }
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TrackerPage />
    </Suspense>
  );
}
