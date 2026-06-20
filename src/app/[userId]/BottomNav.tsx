"use client";
import { useRouter, useParams, usePathname } from "next/navigation";
import { Home as HomeIcon, History as HistoryIcon, Plus, BarChart3, User } from "lucide-react";

// Shared bottom navigation. Drop <BottomNav active="stats" /> onto any page.
// On the main tracker page, prefer the inline <nav> there (it drives tab state
// directly). Use this component on standalone sub-pages (nutrition, account, etc.)
// where navigation should route back to the tracker with the right view.
export default function BottomNav({ active }: { active?: "today" | "history" | "stats" | "profile" }) {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const pathname = usePathname();

  // Route to the tracker, passing the desired tab via query param.
  const go = (tab: "today" | "history" | "add") => {
    router.push(`/${userId}?tab=${tab}`);
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 z-30"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="max-w-md mx-auto h-16 grid grid-cols-5 items-center px-2">
        <NavButton icon={HomeIcon} label="Today" active={active === "today"} onClick={() => go("today")} />
        <NavButton icon={HistoryIcon} label="History" active={active === "history"} onClick={() => go("history")} />
        <div className="flex justify-center">
          <button onClick={() => go("add")}
            className="w-14 h-14 -translate-y-3 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
            style={{ background: "linear-gradient(135deg,#7F77DD,#5b54c4)" }}
            aria-label="Add meal">
            <Plus className="w-7 h-7 text-white" strokeWidth={2.5} />
          </button>
        </div>
        <NavButton icon={BarChart3} label="Stats" active={active === "stats"} onClick={() => router.push(`/${userId}/nutrition`)} />
        <NavButton icon={User} label="Profile" active={active === "profile"} onClick={() => go("today")} />
      </div>
    </nav>
  );
}

function NavButton({ icon: Icon, label, active, onClick }: { icon: any; label: string; active?: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors" style={{ color: active ? "#7F77DD" : "#9ca3af" }}>
      <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
      <span className="text-[10px]" style={{ fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}