import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useStaking } from '../hooks/useStaking';
import { useProtocol } from '../hooks/useProtocol';
import { formatAPY } from '../utils/stellar';
import { NETWORK } from '../config/contracts';

export default function StakeCard() {
  const { isConnected, connect, publicKey } = useWallet();
  const { stake, isStaking, error, lastTxHash, clearError, balance } = useStaking();
  const { stats, apy } = useProtocol();
  const [xlmAmount, setXlmAmount] = useState('');

  const sxlmReceive = xlmAmount
    ? (parseFloat(xlmAmount) / stats.exchangeRate).toFixed(4)
    : '0.0000';

  const handleStake = async () => {
    if (!xlmAmount || parseFloat(xlmAmount) <= 0) return;
    clearError();
    const success = await stake(parseFloat(xlmAmount));
    if (success) setXlmAmount('');
  };

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Stake XLM</h3>
        <span className="text-xs text-neutral-500">
          {formatAPY(apy.currentApr)} APR · {formatAPY(apy.currentApy)} APY
        </span>
      </div>

      <div>
        <label className="label">You stake (XLM)</label>
        <input
          type="number"
          value={xlmAmount}
          onChange={(e) => setXlmAmount(e.target.value)}
          placeholder="0.00"
          className="input font-mono text-lg"
        />
      </div>

      <div className="text-center text-neutral-600 text-xs">becomes</div>

      <div className="bg-black rounded-lg p-4 border border-border">
        <p className="label">You receive (sXLM)</p>
        <p className="font-mono text-lg">{sxlmReceive}</p>
      </div>

      <div className="space-y-1 text-xs text-neutral-500 px-1">
        <div className="flex justify-between">
          <span>Exchange Rate</span>
          <span>1 sXLM = {stats.exchangeRate.toFixed(4)} XLM</span>
        </div>
        {isConnected && balance.sxlmBalance > 0 && (
          <div className="flex justify-between">
            <span>Your sXLM</span>
            <span>{balance.sxlmBalance.toFixed(4)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="border border-red-900 rounded-lg p-3 space-y-2">
          <p className="text-xs text-red-400">{error}</p>
          {error.toLowerCase().includes('friendbot') && publicKey && (
            <a
              href={`${NETWORK.friendbotUrl}?addr=${publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-blue-400 underline"
            >
              Fund your testnet account via Friendbot →
            </a>
          )}
        </div>
      )}

      {lastTxHash && (
        <div className="border border-green-900 rounded-lg p-3">
          <p className="text-xs text-green-400">Staked successfully</p>
        </div>
      )}

      {isConnected ? (
        <button
          onClick={handleStake}
          disabled={isStaking || !xlmAmount || parseFloat(xlmAmount) <= 0}
          className="w-full btn"
        >
          {isStaking ? 'Staking...' : 'Stake XLM'}
        </button>
      ) : (
        <button onClick={connect} className="w-full btn">
          Connect Wallet to Stake
        </button>
      )}
    </div>
  );
}
