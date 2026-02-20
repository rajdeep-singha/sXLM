import WithdrawCard from '../components/WithdrawCard';

export default function Withdraw() {
  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Withdraw</h1>
        <p className="text-neutral-500 text-sm">Burn sXLM to receive XLM at the current exchange rate</p>
      </div>

      <WithdrawCard />

      <div className="card p-5 space-y-3 text-xs text-neutral-500">
        <p><span className="text-neutral-300 font-medium">Instant</span> - If the liquidity buffer has enough XLM, your withdrawal processes immediately.</p>
        <p><span className="text-neutral-300 font-medium">Delayed</span> - If the buffer is insufficient, you enter a queue. Claim after ~24h cooldown.</p>
      </div>
    </div>
  );
}
