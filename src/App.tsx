import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Executions } from './components/views/Executions';
import { PivotView } from './components/views/PivotView';
import { ExecutionReport } from './components/views/ExecutionReport';
import { ExplorerView } from './components/views/ExplorerView';
import { Profile } from './components/views/Profile';
import Scaling from './components/views/Scaling';
import GroupedView from './components/views/GroupedView';
import SavedQueriesView from './components/views/SavedQueriesView';

import { DashboardView } from './components/views/Dashboard';

const queryClient = new QueryClient();

function App() {
  return (
    <div className="app" style={{ width: '100vw' }}>
      <QueryClientProvider client={queryClient}>
        <ChakraProvider>
          <Router>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardView />} />
                <Route path="/executions" element={<Executions />} />
                <Route path="/executions/:id" element={<ExecutionReport />} />
                <Route path="/pivot" element={<PivotView />} />
                <Route path="/explorer" element={<ExplorerView />} />
                <Route path="/scaling" element={<Scaling />} />
                <Route path="/grouped" element={<GroupedView />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/saved-queries" element={<SavedQueriesView />} />
              </Routes>
            </Layout>
          </Router>
        </ChakraProvider>
      </QueryClientProvider>
    </div>
  );
}

export default App;
