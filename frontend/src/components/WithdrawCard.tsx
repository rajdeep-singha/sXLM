import { useState } from 'react';
import axios from '../lib/apiClient';
import { useWallet } from '../hooks/useWallet';
import { useStaking } from '../hooks/useStaking';
import { useProtocol } from '../hooks/useProtocol';
import { API_BASE_URL } from '../config/contracts';

export default function WithdrawCard() {
  const { isConnected, connect, publicKey, signTransaction } = useWallet();
  const { unstake, claimWithdrawal, isUnstaking, isClaiming, pendingWithdrawals, error, clearError, balance, refreshBalance } = useStaking();
  const { stats } = useProtocol();
  const [sxlmAmount, setSxlmAmount] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  const isArchived = (balance as { archived?: boolean }).archived === true
    || (error?.includes('ENTRY_ARCHIVED') ?? false)
    || (error?.includes('expired') ?? false);

  const xlmReceive = sxlmAmount
    ? (parseFloat(sxlmAmount) * stats.exchangeRate).toFixed(4)
    : '0.0000';

  const handleUnstake = async () => {
    if (!sxlmAmount || parseFloat(sxlmAmount) <= 0) return;
    clearError();
    setRestoreError(null);
    const success = await unstake(parseFloat(sxlmAmount));
    if (success) setSxlmAmount('');
  };

  const handleRestore = async () => {
    if (!publicKey) return;
    setIsRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(false);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/staking/restore-balance`, {
        userAddress: publicKey,
      });
      const signedXdr = await signTransaction(data.xdr, data.networkPassphrase);
      await axios.post(`${API_BASE_URL}/api/staking/submit`, { signedXdr });
      setRestoreSuccess(true);
      await refreshBalance();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : err instanceof Error ? err.message : 'Restore failed';
      setRestoreError(msg);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="card p-6 space-y-4">
      <h3 className="text-sm font-semibold">Withdraw</h3>

      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="label mb-0">You burn (sXLM)</label>
          {isConnected && balance.sxlmBalance > 0 && (
            <button
              onClick={() => setSxlmAmount(balance.sxlmBalance.toFixed(7))}
              className="text-[10px] text-neutral-500 hover:text-white"
            >
              MAX: {balance.sxlmBalance.toFixed(4)}
            </button>
          )}
        </div>
        <input
          type="number"
          value={sxlmAmount}
          onChange={(e) => setSxlmAmount(e.target.value)}
          placeholder="0.00"
          max={balance.sxlmBalance}
          className="input font-mono text-lg"
        />
      </div>

      <div className="text-center text-neutral-600 text-xs">becomes</div>

      <div className="bg-black rounded-lg p-4 border border-border">
        <p className="label">You receive (XLM)</p>
        <p className="font-mono text-lg">{xlmReceive}</p>
      </div>

      <div className="flex gap-3 text-xs text-neutral-500">
        <div className="flex-1 border border-border rounded-lg p-3">
          <p className="text-neutral-400 font-medium">Instant</p>
          <p className="text-[10px] mt-0.5">If buffer available</p>
        </div>
        <div className="flex-1 border border-border rounded-lg p-3">
          <p className="text-neutral-400 font-medium">Delayed</p>
          <p className="text-[10px] mt-0.5">~24h cooldown</p>
        </div>
      </div>

      {/* Archived / TTL expired banner */}
      {isConnected && isArchived && !restoreSuccess && (
        <div className="border border-neutral-700 rounded-lg p-4 space-y-3">
          <p className="text-xs text-neutral-300">
            Your sXLM balance entry expired on testnet (TTL). Sign a free restore transaction to recover it.
          </p>
          {restoreError && <p className="text-xs text-red-400">{restoreError}</p>}
          <button
            onClick={handleRestore}
            disabled={isRestoring}
            className="w-full btn text-sm"
          >
            {isRestoring ? 'Restoring...' : 'Restore Balance'}
          </button>
        </div>
      )}

      {restoreSuccess && (
        <div className="border border-neutral-700 rounded-lg p-3">
          <p className="text-xs text-neutral-300">Balance restored. You can now withdraw.</p>
        </div>
      )}

      {error && !isArchived && (
        <div className="border border-red-900 rounded-lg p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {isConnected ? (
        <button
          onClick={handleUnstake}
          disabled={isUnstaking || !sxlmAmount || parseFloat(sxlmAmount) <= 0 || isArchived}
          className="w-full btn"
        >
          {isUnstaking ? 'Processing...' : 'Unstake sXLM'}
        </button>
      ) : (
        <button onClick={connect} className="w-full btn">Connect Wallet</button>
      )}

      {pendingWithdrawals.length > 0 && (
        <div className="pt-4 border-t border-border">
          <h4 className="text-xs font-medium text-neutral-400 mb-3">Pending Withdrawals</h4>
          <div className="space-y-2">
            {pendingWithdrawals.map((w: { id: string; amount: string; unlockTime: string; status: string }) => (
              <div key={w.id} className="flex items-center justify-between bg-black rounded-lg p-3 border border-border">
                <div>
                  <p className="text-sm">{(Number(w.amount) / 1e7).toFixed(2)} XLM</p>
                  <p className="text-[10px] text-neutral-600">
                    {new Date(w.unlockTime) <= new Date() ? 'Ready to claim' : `Unlocks ${new Date(w.unlockTime).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => claimWithdrawal(w.id)}
                  disabled={isClaiming || new Date(w.unlockTime) > new Date()}
                  className="btn-outline text-xs px-3 py-1.5"
                >
                  {isClaiming ? '...' : 'Claim'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
