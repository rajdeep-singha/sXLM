import { Routes, Route, useLocation, Link } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Stake from './pages/Stake';
import Withdraw from './pages/Withdraw';
import Lending from './pages/Lending';
import Liquidity from './pages/Liquidity';
import Governance from './pages/Governance';
import Analytics from './pages/Analytics';
import Docs from './pages/Docs';
import Career from './pages/Career';

function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const hideNav = ['/docs', '/career'].includes(location.pathname);

  return (
    <div className="flex flex-col bg-[#F5F5F5] min-h-screen">
      {!hideNav && <Navbar />}
      <main className={isHome || hideNav ? '' : 'pt-[60px]'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stake" element={<Stake />} />
          <Route path="/withdraw" element={<Withdraw />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/liquidity" element={<Liquidity />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/career" element={<Career />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;

function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-black/40 uppercase tracking-wider">404</p>
      <h1 className="text-3xl font-medium text-black" style={{ letterSpacing: '-0.03em' }}>
        This page doesn't exist
      </h1>
      <p className="text-black/60 max-w-md">
        It may have moved, or it may be something StelloFi no longer does.
      </p>
      <Link to="/" className="text-black underline underline-offset-4">
        Back to the dashboard
      </Link>
    </div>
  );
}
