import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BrainCircuit,
  Database,
  Map as MapIcon,
  MessageSquare,
  Activity,
  Briefcase,
  History,
  Settings,
  Wifi,
  WifiOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health, isError } = useHealthCheck({ query: { refetchInterval: 30000, queryKey: ['healthz'] } });

  const navigation = [
    { name: "Dashboard", href: "/", icon: Activity },
    { name: "Knowledge Hub", href: "/knowledge", icon: Database },
    { name: "Brain Explorer", href: "/brain", icon: BrainCircuit },
    { name: "Brand Profile", href: "/brand", icon: Briefcase },
    { name: "Ask the Brain", href: "/ask", icon: MessageSquare },
    { name: "Brand Mapping", href: "/map", icon: MapIcon },
    { name: "Strategy Output", href: "/strategy", icon: Settings },
    { name: "Run History", href: "/runs", icon: History },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center justify-between px-6 border-b border-sidebar-border">
          <div className="flex flex-col leading-tight text-sidebar-primary">
            <div className="flex items-center gap-2 font-bold text-lg tracking-tight font-mono">
              <BrainCircuit className="h-5 w-5 shrink-0" />
              <span>Tryps</span>
            </div>
            <span className="text-[10px] font-medium text-sidebar-primary/60 tracking-widest uppercase pl-7">AEO / GEO Automation</span>
          </div>
          <div className="flex items-center justify-center">
            {isError || health?.status !== "ok" ? (
              <WifiOff className="h-4 w-4 text-destructive" aria-label="API Disconnected" />
            ) : (
              <Wifi className="h-4 w-4 text-emerald-500" aria-label="API Connected" />
            )}
          </div>
        </div>

        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {navigation.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-sidebar-accent/50">
            <div className="h-8 w-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-xs">
              AN
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-sidebar-foreground">Analyst Profile</span>
              <span className="text-[10px] text-sidebar-foreground/50">Senior Partner</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
