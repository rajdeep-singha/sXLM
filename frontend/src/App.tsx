import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Stake from './pages/Stake';
import Withdraw from './pages/Withdraw';
import Validators from './pages/Validators';
import Analytics from './pages/Analytics';
import Lending from './pages/Lending';
import Liquidity from './pages/Liquidity';
import Governance from './pages/Governance';
import Leverage from './pages/Leverage';
import Restaking from './pages/Restaking';

function AppContent() {
  const location = useLocation();
  const isLandingPage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-black text-white">
      {!isLandingPage && <Navbar />}
      <main className={!isLandingPage ? 'pt-16' : ''}>
        <Routes>
          <Route path="/" element={<Landing />} />
          {/* <Route path="/dashboard" element={<Dashboard />} /> */}
          <Route path="/stake" element={<Stake />} />
          <Route path="/withdraw" element={<Withdraw />} />
          <Route path="/validators" element={<Validators />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/liquidity" element={<Liquidity />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/leverage" element={<Leverage />} />
          <Route path="/restaking" element={<Restaking />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return <AppContent />;
}

export default App;
