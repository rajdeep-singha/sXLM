import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useStaking } from '../hooks/useStaking';
import { useProtocol } from '../hooks/useProtocol';
import { formatAPY } from '../utils/stellar';
import { NETWORK } from '../config/contracts';

export default function StakeCard() {
  const { isConnected, connect, publicKey } = useWallet();
  const { stake, isStaking, isPending, error, lastTxHash, clearError, balance } = useStaking();
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
        <h3 className="text-sm font-semibold text-white">Stake XLM</h3>
        <span className="tag-yellow">
          {formatAPY(apy.currentApr)} APR
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

      <div className="flex items-center justify-center gap-3 text-neutral-700 text-xs">
        <div className="flex-1 h-px bg-border" />
        <span>becomes</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div
        className="rounded-lg p-4"
        style={{ background: '#080808', border: '1px solid #1e1e1e' }}
      >
        <p className="label">You receive (sXLM)</p>
        <p className="font-mono text-xl font-semibold" style={{ color: '#F5CF00' }}>
          {sxlmReceive}
        </p>
      </div>

      <div className="space-y-1.5 text-xs px-1" style={{ color: '#525252' }}>
        <div className="flex justify-between">
          <span>Exchange Rate</span>
          <span className="text-neutral-400">1 sXLM = {stats.exchangeRate.toFixed(4)} XLM</span>
        </div>
        {isConnected && (
          <div className="flex justify-between">
            <span>Available XLM</span>
            <span className="text-neutral-400">{balance.xlmNativeBalance.toFixed(4)} XLM</span>
          </div>
        )}
        {isConnected && balance.sxlmBalance > 0 && (
          <div className="flex justify-between">
            <span>Your sXLM</span>
            <span className="font-mono" style={{ color: '#F5CF00' }}>{balance.sxlmBalance.toFixed(4)} sXLM</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>30d APY</span>
          <span className="text-neutral-400">{formatAPY(apy.apy30d)}</span>
        </div>
      </div>

      {error && (
        <div className="banner-error space-y-2">
          <p className="text-xs text-red-400">{error}</p>
          {error.toLowerCase().includes('friendbot') && publicKey && (
            <a
              href={`${NETWORK.friendbotUrl}?addr=${publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs underline"
              style={{ color: '#F5CF00' }}
            >
              Fund your testnet account via Friendbot →
            </a>
          )}
        </div>
      )}

      {lastTxHash && (
        <div className={isPending ? "banner-warning space-y-1" : "banner-success space-y-1"}>
          <p className={`text-xs ${isPending ? 'text-yellow-400' : 'text-green-400'}`}>
            {isPending
              ? 'Transaction submitted — confirming on Stellar (may take a moment)'
              : 'Staked successfully — sXLM minted to your wallet'}
          </p>
          <a
            href={`https://stellar.expert/explorer/public/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[10px] font-mono truncate"
            style={{ color: isPending ? '#F5CF00' : '#4ade80', opacity: 0.7 }}
          >
            {lastTxHash}
          </a>
        </div>
      )}

      {isConnected ? (
        <button
          onClick={handleStake}
          disabled={isStaking || !xlmAmount || parseFloat(xlmAmount) <= 0}
          className="w-full btn"
        >
          {isStaking ? 'Processing...' : 'Stake XLM'}
        </button>
      ) : (
        <button onClick={connect} className="w-full btn">
          Connect Wallet to Stake
        </button>
      )}
    </div>
  );
}
