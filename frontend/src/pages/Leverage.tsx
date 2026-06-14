import { useState } from 'react';
import { TrendingUp, Calculator, Zap } from 'lucide-react';
import axios from '../lib/apiClient';
import { API_BASE_URL } from '../config/contracts';

interface SimResult {
  maxLeverage: number;
  effectiveLeverage: number;
  totalStaked: number;
  totalBorrowed: number;
  netYieldPercent: number;
  grossYield: number;
  borrowCost: number;
  netYield: number;
  loops: { loop: number; deposited: number; borrowed: number; totalStaked: number; totalBorrowed: number }[];
}

interface OptimalResult {
  collateralFactor: number;
  maxLeverage: number;
  optimalLoops: number;
  stakingAPR: number;
  borrowAPR: number;
  netYieldPercent: number;
}

export default function Leverage() {
  const [principal, setPrincipal] = useState('1000');
  const [loops, setLoops] = useState('3');
  const [collateralFactor, setCollateralFactor] = useState('0.7');
  const [stakingAPR, setStakingAPR] = useState('0');
  const [borrowAPR, setBorrowAPR] = useState('0.04');
  const [result, setResult] = useState<SimResult | null>(null);
  const [optimalResult, setOptimalResult] = useState<OptimalResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSimulate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/leverage/simulate`, {
        principal: parseFloat(principal),
        loops: parseInt(loops),
        collateralFactor: parseFloat(collateralFactor),
        stakingAPR: parseFloat(stakingAPR),
        borrowAPR: parseFloat(borrowAPR),
      });
      setResult(data);
    } catch (err: unknown) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Simulation failed' : 'Simulation failed');
    }
    setIsLoading(false);
  };

  const handleOptimal = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/leverage/optimal`);
      setOptimalResult(data);
    } catch {
      setError('Could not fetch optimal leverage');
    }
    setIsLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">DeFi</p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Leverage Simulator</h1>
        <p className="text-sm text-gray-500">Calculate optimal leverage for sXLM staking yield</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Input Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-black" />
            <h3 className="text-sm font-semibold text-black">Parameters</h3>
          </div>

          {[
            { label: 'Principal (XLM)', value: principal, setter: setPrincipal },
            { label: 'Loops', value: loops, setter: setLoops },
            { label: 'Collateral Factor', value: collateralFactor, setter: setCollateralFactor },
            { label: 'Staking APR', value: stakingAPR, setter: setStakingAPR },
            { label: 'Borrow APR', value: borrowAPR, setter: setBorrowAPR },
          ].map(({ label, value, setter }) => (
            <div key={label}>
              <label className="label">{label}</label>
              <input
                type="number"
                value={value}
                onChange={(e) => setter(e.target.value)}
                step="any"
                className="input font-mono"
              />
            </div>
          ))}

          {error && <div className="banner-error"><p className="text-xs text-red-500">{error}</p></div>}

          <div className="flex gap-3">
            <button onClick={handleSimulate} disabled={isLoading} className="flex-1 btn">
              {isLoading ? 'Simulating…' : 'Simulate'}
            </button>
            <button
              onClick={handleOptimal}
              disabled={isLoading}
              className="flex items-center gap-1 px-4 py-2.5 rounded-full border border-black text-black hover:bg-black hover:text-white transition-all duration-200 text-sm font-medium disabled:opacity-40"
            >
              <Zap className="w-4 h-4" /> Optimal
            </button>
          </div>
        </div>

        {/* Results Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-black" />
            <h3 className="text-sm font-semibold text-black">Results</h3>
          </div>

          {result ? (
            <div className="space-y-3">
              {[
                { label: 'Effective Leverage', value: result.effectiveLeverage.toFixed(2) + 'x' },
                { label: 'Net Yield', value: result.netYieldPercent.toFixed(2) + '%' },
                { label: 'Total Staked', value: result.totalStaked.toFixed(2) + ' XLM' },
                { label: 'Total Borrowed', value: result.totalBorrowed.toFixed(2) + ' XLM' },
                { label: 'Net Position', value: (result.totalStaked - result.totalBorrowed).toFixed(2) + ' XLM' },
                { label: 'Annual Return', value: result.netYield.toFixed(2) + ' XLM' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-black font-medium font-mono">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Run a simulation to see results.</p>
          )}

          {optimalResult && (
            <div className="mt-4 p-4 rounded-xl bg-[#F5F5F5] border border-[#e5e5e5] space-y-2">
              <p className="text-xs font-semibold text-black">Optimal Strategy</p>
              {[
                { label: 'Optimal Loops', value: String(optimalResult.optimalLoops) },
                { label: 'Net Yield', value: optimalResult.netYieldPercent.toFixed(2) + '%' },
                { label: 'Leverage', value: optimalResult.maxLeverage.toFixed(2) + 'x' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-black font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Formula Info */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-black">How Leverage Works</h3>
        <div className="space-y-2 text-sm text-gray-500">
          <p>Leverage = 1 / (1 − c), where c = collateral factor</p>
          <p>Net Yield = (Leverage × Staking APR) − ((Leverage − 1) × Borrow APR)</p>
          <p>Example: c=0.7, r=APR%, b=4% → Leverage=3.33×, Net Yield=(L×r)−((L−1)×b)</p>
        </div>
      </div>
    </div>
  );
}
