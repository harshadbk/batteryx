import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/layout/AppShell'
import Assistant from './pages/Assistant'
import Cells from './pages/Cells'
import Compare from './pages/Compare'
import Electrical from './pages/Electrical'
import Landing from './pages/Landing'
import Packaging from './pages/Packaging'
import Projects from './pages/Projects'
import Report from './pages/Report'
import Simulator from './pages/Simulator'
import Safety from './pages/Safety'
import Thermal from './pages/Thermal'
import Topology from './pages/Topology'
import Wizard from './pages/Wizard'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="projects" replace />} />
        <Route path="projects" element={<Projects />} />
        <Route path="wizard" element={<Wizard />} />
        <Route path="cells" element={<Cells />} />
        <Route path="topology" element={<Topology />} />
        <Route path="electrical" element={<Electrical />} />
        <Route path="thermal" element={<Thermal />} />
        <Route path="safety" element={<Safety />} />
        <Route path="packaging" element={<Packaging />} />
        <Route path="compare" element={<Compare />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="report" element={<Report />} />
        <Route path="simulator" element={<Simulator />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
