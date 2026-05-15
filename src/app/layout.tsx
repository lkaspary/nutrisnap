import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({ subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Caloriq", description: "AI-powered calorie and macro tracker",
  manifest: "/manifest.json", appleWebApp: { capable: true, statusBarStyle: "default", title: "Caloriq" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#7F77DD" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <script dangerouslySetInnerHTML={{__html: `(function(){try{var t=localStorage.getItem('caloriq-theme');if(t==='dark'){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}})();`}} />
      </head>
      <body className={inter.className}>
        {children}
        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              regs.forEach(function(reg) { reg.unregister(); });
            });
            caches.keys().then(function(keys) {
              keys.forEach(function(key) { caches.delete(key); });
            });
          }
        `}} />
      </body>
    </html>
  );
}