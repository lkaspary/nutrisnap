import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({ subsets: ["latin"] });
export const metadata: Metadata = {
  title:"Calorie Tracker", description:"AI-powered calorie and macro tracker",
  manifest:"/manifest.json", appleWebApp:{capable:true,statusBarStyle:"default",title:"Calorie Tracker"},
};
export const viewport: Viewport = {width:"device-width",initialScale:1,maximumScale:1,themeColor:"#ffffff"};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return (<html lang="en"><body className={inter.className}>{children}</body></html>);
}
