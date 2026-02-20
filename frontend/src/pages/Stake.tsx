import StakeCard from '../components/StakeCard';
import { useProtocol } from '../hooks/useProtocol';
import { formatAPY } from '../utils/stellar';

export default function Stake() {
  const { stats, apy } = useProtocol();

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Stake XLM</h1>
        <p className="text-neutral-500 text-sm">Earn {formatAPY(apy.currentApy)} APY on your staked XLM</p>
      </div>

      <StakeCard />

      <div className="card p-5 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Exchange Rate</span>
          <span>1 sXLM = {stats.exchangeRate.toFixed(6)} XLM</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Current APY</span>
          <span>{formatAPY(apy.currentApy)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">7-Day Yield</span>
          <span>{formatAPY(apy.apy7d)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">30-Day Yield</span>
          <span>{formatAPY(apy.apy30d)}</span>
        </div>
      </div>
    </div>
  );
}
