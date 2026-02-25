import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Settings } from "./pages/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
