import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrandProvider } from "@/hooks/use-brand-context";
import { ErrorBoundary } from "@/components/error-boundary";

import Dashboard from "@/pages/dashboard";
import KnowledgeHub from "@/pages/knowledge";
import BrainExplorer from "@/pages/brain";
import BrandProfile from "@/pages/brand";
import AskBrain from "@/pages/ask";
import BrandMapping from "@/pages/map";
import StrategyOutput from "@/pages/strategy";
import RunsHistory from "@/pages/runs";
import RunDetail from "@/pages/run-detail";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/knowledge" component={KnowledgeHub} />
      <Route path="/brain" component={BrainExplorer} />
      <Route path="/brand" component={BrandProfile} />
      <Route path="/ask" component={AskBrain} />
      <Route path="/map" component={BrandMapping} />
      <Route path="/strategy" component={StrategyOutput} />
      <Route path="/runs/:id" component={RunDetail} />
      <Route path="/runs" component={RunsHistory} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </BrandProvider>
    </QueryClientProvider>
  );
}

export default App;
