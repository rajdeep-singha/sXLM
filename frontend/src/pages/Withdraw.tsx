import WithdrawCard from '../components/WithdrawCard';

export default function Withdraw() {
  return (
    <div className="max-w-lg mx-auto px-4 py-10 space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">
          Unstake
        </p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Withdraw</h1>
        <p className="text-sm text-gray-500">
          Burn sXLM to receive XLM at the current exchange rate
        </p>
      </div>

      <WithdrawCard />

      <div className="card p-5 space-y-3 text-xs text-gray-500">
        <p>
          <span className="text-black font-medium">Instant</span>
          {' '}— If the liquidity buffer has enough XLM, your withdrawal processes immediately.
        </p>
        <p>
          <span className="text-black font-medium">Delayed</span>
          {' '}— If the buffer is insufficient, you enter a queue. Claim after ~24h cooldown.
        </p>
      </div>
    </div>
  );
}
