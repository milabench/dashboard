import {
  ChakraProvider,
  createSystem,
  defaultConfig
} from '@chakra-ui/react';
import { ColorModeProvider } from "./components/ui/color-mode"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Executions } from './components/views/Executions';
import { PivotView } from './components/views/PivotView';
import { PivotPlotPage } from './components/views/PivotPlotPage';
import { PivotTableSharePage } from './components/views/PivotTableSharePage';
import { PivotPlotSharePage } from './components/views/PivotPlotSharePage';
import { ShareExecutionReport } from './components/views/ShareExecutionReport';
import { ExecutionReport } from './components/views/ExecutionReport';
import { ExplorerView } from './components/views/ExplorerView';
import { Profile } from './components/views/Profile';
import Scaling from './components/views/Scaling';
import SavedQueriesView from './components/views/SavedQueriesView';
import { DashboardView } from './components/views/Dashboard';
import { JobSubmitView } from './components/views/JobSubmitView';
import { JobDetailsView } from './components/views/JobDetails';
import { JobLogsView } from './components/views/JobLogs';
import { PipelinesView } from './components/views/PipelinesView';
import { RealtimeMetricsView } from './components/views/RealtimeMetricsView';
import { DatafileView } from './components/views/DatafileView';
import { VegaPlotBuilderView } from './components/views/VegaPlotBuilderView';
import { BaremetalView } from './components/views/BaremetalView';
import { PushResultsView } from './components/views/PushResultsView';
import { DatabaseSyncView } from './components/views/DatabaseSyncView';
import { SupportedGpusView } from './components/views/SupportedGpusView';
import { GpuComparisonView } from './components/views/GpuEvolutionView';
import { BenchmarkHistoryView } from './components/views/BenchmarkHistoryView';
import { BreakdownView } from './components/views/BreakdownView';
import { ScheduledJobsView } from './components/views/ScheduledJobsView';
import { Toaster } from "./components/ui/toaster"
import { VegaProvider } from './contexts/VegaContext'
import { HealthProvider } from './contexts/HealthContext'
import { MaintenanceBanner } from './components/layout/MaintenanceBanner'

// Create the theme system for Chakra UI v3
const system = createSystem(defaultConfig);
const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={system}>
        <ColorModeProvider>
          <HealthProvider>
          <VegaProvider>
          <Toaster />
          <Router>
            <MaintenanceBanner />
            <Layout>
              <Routes>
                {import.meta.env.DEV ? (
                  <>
                    <Route path="/" element={<SupportedGpusView />} />
                    <Route path="/jobs" element={<DashboardView />} />
                    <Route path="/jobs/submit" element={<JobSubmitView />} />
                    <Route path="/jobrunner/:slurmJobId/:jrJobId" element={<JobDetailsView />} />
                    <Route path="/joblogs/:slurmJobId/:jrJobId" element={<JobLogsView />} />
                    <Route path="/pipelines" element={<PipelinesView />} />
                    <Route path="/realtime" element={<RealtimeMetricsView />} />
                    <Route path="/datafile" element={<DatafileView />} />
                    <Route path="/datafile/vega" element={<VegaPlotBuilderView />} />
                    <Route path="/baremetal" element={<BaremetalView />} />
                    <Route path="/scheduled" element={<ScheduledJobsView />} />
                    <Route path="/db-sync" element={<DatabaseSyncView />} />
                  </>
                ) : (
                  <Route path="/" element={<SupportedGpusView />} />
                )}

                <Route path="/executions" element={<Executions />} />
                <Route path="/breakdown" element={<BreakdownView />} />
                <Route path="/executions/:id" element={<ExecutionReport />} />
                <Route path="/share/:token" element={<ShareExecutionReport />} />
                <Route path="/pivot/view/table" element={<PivotTableSharePage />} />
                <Route path="/pivot/view/plot" element={<PivotPlotSharePage />} />
                <Route path="/pivot" element={<PivotView />} />
                <Route path="/pivot/plot" element={<PivotPlotPage />} />
                <Route path="/explorer" element={<ExplorerView />} />
                <Route path="/scaling" element={<Scaling />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/saved-queries" element={<SavedQueriesView />} />
                <Route path="/push" element={<PushResultsView />} />
                <Route path="/gpus" element={<SupportedGpusView />} />
                <Route path="/gpu-comparison" element={<GpuComparisonView />} />
                <Route path="/bench-history" element={<BenchmarkHistoryView />} />
              </Routes>
            </Layout>
          </Router>
          </VegaProvider>
          </HealthProvider>
        </ColorModeProvider>
      </ChakraProvider>
    </QueryClientProvider>
  );
}

export default App;
