export async function generateStaticParams() { return [{ userId: "_" }]; }

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
