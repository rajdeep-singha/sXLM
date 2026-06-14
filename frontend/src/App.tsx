import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Stake from './pages/Stake';
import Withdraw from './pages/Withdraw';
import Lending from './pages/Lending';
import Liquidity from './pages/Liquidity';
import Governance from './pages/Governance';
import Leverage from './pages/Leverage';
import Restaking from './pages/Restaking';
import Docs from './pages/Docs';

function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="flex flex-col bg-[#F5F5F5] min-h-screen">
      <Navbar />
      <main className={isHome ? '' : 'pt-[60px]'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stake" element={<Stake />} />
          <Route path="/withdraw" element={<Withdraw />} />
          <Route path="/lending" element={<Lending />} />
          <Route path="/liquidity" element={<Liquidity />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/leverage" element={<Leverage />} />
          <Route path="/restaking" element={<Restaking />} />
          <Route path="/docs" element={<Docs />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
