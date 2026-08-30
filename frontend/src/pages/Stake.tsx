import StakeCard from '../components/StakeCard';
import { useProtocol } from '../hooks/useProtocol';
import { formatAPY } from '../utils/stellar';

export default function Stake() {
  const { stats, apy } = useProtocol();

  return (
    <div className="max-w-lg mx-auto px-4 py-10 space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">
          Vault
        </p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Stake XLM</h1>
        <p className="text-sm text-gray-500">
          Deposit XLM, receive sXLM · current rate {formatAPY(apy.currentApy)} APY
        </p>
      </div>

      <StakeCard />

      <div className="card p-5 space-y-3">
        {[
          { label: 'Exchange Rate',  val: `1 sXLM = ${stats.exchangeRate.toFixed(6)} XLM` },
          { label: 'Current APY',    val: formatAPY(apy.currentApy) },
          { label: '7-Day Yield',    val: formatAPY(apy.apy7d) },
          { label: '30-Day Yield',   val: formatAPY(apy.apy30d) },
        ].map(({ label, val }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-black font-mono">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
