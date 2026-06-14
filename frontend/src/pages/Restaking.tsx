import { useState } from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';
import axios from '../lib/apiClient';
import { API_BASE_URL } from '../config/contracts';
import { useWallet } from '../hooks/useWallet';

interface RestakingStep {
  step: number;
  action: string;
  amount: number;
  totalStaked: number;
  totalBorrowed: number;
  healthFactor: number;
}

interface SimResult {
  initialDeposit: number;
  loops: number;
  totalStaked: number;
  totalBorrowed: number;
  effectiveLeverage: number;
  estimatedNetAPR: number;
  healthFactor: number;
  steps: RestakingStep[];
}

interface RestakingPosition {
  wallet: string;
  totalStaked: number;
  totalBorrowed: number;
  effectiveLeverage: number;
  healthFactor: number;
  netAPR: number;
  loops: number;
}

export default function Restaking() {
  const { publicKey, isConnected } = useWallet();
  const [principal, setPrincipal] = useState('1000');
  const [loops, setLoops] = useState('3');
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [position, setPosition] = useState<RestakingPosition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSimulate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/restaking/simulate`, {
        principal: parseFloat(principal),
        loops: parseInt(loops),
      });
      setSimResult(data);
    } catch {
      setError('Simulation failed');
    }
    setIsLoading(false);
  };

  const handleFetchPosition = async () => {
    if (!publicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/restaking/position/${publicKey}`);
      setPosition(data);
    } catch {
      setError('Could not fetch position');
    }
    setIsLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">DeFi</p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Restaking</h1>
        <p className="text-sm text-gray-500">Automated stake → collateral → borrow → restake loop</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Simulate Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-black" />
            <h3 className="text-sm font-semibold text-black">Simulate Restaking</h3>
          </div>

          <div>
            <label className="label">Principal (XLM)</label>
            <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="input font-mono" />
          </div>
          <div>
            <label className="label">Number of Loops</label>
            <input type="number" value={loops} onChange={(e) => setLoops(e.target.value)} min="1" max="10" className="input font-mono" />
          </div>

          {error && <div className="banner-error"><p className="text-xs text-red-500">{error}</p></div>}

          <button onClick={handleSimulate} disabled={isLoading} className="w-full btn">
            {isLoading ? 'Simulating…' : 'Simulate'}
          </button>

          {isConnected && (
            <button
              onClick={handleFetchPosition}
              disabled={isLoading}
              className="w-full py-2 rounded-full border border-[#e5e5e5] text-gray-500 hover:bg-[#F5F5F5] hover:text-black transition-colors text-sm"
            >
              Fetch My Position
            </button>
          )}
        </div>

        {/* Results Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-black" />
            <h3 className="text-sm font-semibold text-black">Results</h3>
          </div>

          {simResult ? (
            <div className="space-y-4">
              <div className="space-y-2">
                {[
                  { label: 'Total Staked', value: simResult.totalStaked.toFixed(2) + ' XLM' },
                  { label: 'Total Borrowed', value: simResult.totalBorrowed.toFixed(2) + ' XLM' },
                  { label: 'Net Position', value: (simResult.totalStaked - simResult.totalBorrowed).toFixed(2) + ' XLM' },
                  { label: 'Effective Leverage', value: simResult.effectiveLeverage.toFixed(2) + 'x' },
                  { label: 'Estimated Net APR', value: simResult.estimatedNetAPR.toFixed(2) + '%' },
                  { label: 'Health Factor', value: simResult.healthFactor === Infinity ? '∞' : simResult.healthFactor.toFixed(2) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-black font-medium font-mono">{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-2">Step Breakdown</p>
                <div className="space-y-1">
                  {simResult.steps.map((step) => (
                    <div key={step.step} className="flex justify-between text-xs bg-[#F5F5F5] rounded-lg px-3 py-2">
                      <span className="text-gray-500">#{step.step} {step.action}</span>
                      <span className="text-black font-mono">{step.amount.toFixed(1)} XLM</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : position ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-black">Your Restaking Position</p>
              {[
                { label: 'Total Staked', value: position.totalStaked.toFixed(2) + ' XLM' },
                { label: 'Total Borrowed', value: position.totalBorrowed.toFixed(2) + ' XLM' },
                { label: 'Net APR', value: position.netAPR.toFixed(2) + '%' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-black font-mono">{value}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Health Factor</span>
                <span className={`font-bold font-mono ${
                  position.healthFactor > 1.5 ? 'text-green-600' :
                  position.healthFactor > 1.0 ? 'text-orange-500' : 'text-red-500'
                }`}>
                  {position.healthFactor.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Run a simulation to see results.</p>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-black">How Restaking Works</h3>
        <div className="space-y-2 text-sm text-gray-500">
          <p>1. Stake XLM to receive sXLM (earning staking yield)</p>
          <p>2. Deposit sXLM as collateral in the lending contract</p>
          <p>3. Borrow XLM against your sXLM collateral (up to 70%)</p>
          <p>4. Stake the borrowed XLM again to get more sXLM</p>
          <p>5. Repeat for N loops, each time staking more and borrowing more</p>
          <p className="text-xs text-gray-400">
            This amplifies your staking yield but also increases liquidation risk.
          </p>
        </div>
      </div>
    </div>
  );
}
