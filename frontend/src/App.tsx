import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Overview } from "./pages/Overview";
import { ProjectPage } from "./pages/ProjectPage";
import { SessionPage } from "./pages/SessionPage";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/project/:id/session/:sessionId" element={<SessionPage />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
