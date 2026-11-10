import "./dashboard.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="app-root">{children}</div>;
}
