import { useState } from 'react';
import { Shield, AlertTriangle, TrendingUp, Zap } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useLending } from '../hooks/useLending';
import { formatXLM } from '../utils/stellar';

export default function Lending() {
  const { isConnected, connect } = useWallet();
  const {
    position,
    stats,
    isLoading,
    isSubmitting,
    isPending,
    error,
    lastTxHash,
    depositCollateral,
    withdrawCollateral,
    borrow,
    repay,
    liquidate,
    clearError,
  } = useLending();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'borrow' | 'repay' | 'liquidate'>('deposit');
  const [amount, setAmount] = useState('');
  const [borrowerAddress, setBorrowerAddress] = useState('');

  const handleSubmit = async () => {
    clearError();

    if (activeTab === 'liquidate') {
      if (!borrowerAddress) return;
      const success = await liquidate(borrowerAddress);
      if (success) setBorrowerAddress('');
      return;
    }

    const val = parseFloat(amount);
    if (!val || val <= 0) return;

    let success = false;
    switch (activeTab) {
      case 'deposit':  success = await depositCollateral(val); break;
      case 'withdraw': success = await withdrawCollateral(val); break;
      case 'borrow':   success = await borrow(val); break;
      case 'repay':    success = await repay(val); break;
    }
    if (success) setAmount('');
  };

  const buttonLabels = {
    deposit: 'Deposit Collateral',
    withdraw: 'Withdraw Collateral',
    borrow: 'Borrow XLM',
    repay: 'Repay Debt',
    liquidate: 'Liquidate Position',
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">Lending</p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Lending</h1>
        <p className="text-sm text-gray-500">Use sXLM as collateral to borrow XLM</p>
      </div>

      {/* Protocol Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Available Liquidity', value: formatXLM(stats.poolBalance) + ' XLM', highlight: true },
          { label: 'Total Collateral', value: formatXLM(stats.totalCollateral) + ' sXLM' },
          { label: 'Collateral Factor', value: (stats.collateralFactorBps / 100) + '%' },
          { label: 'Borrow Rate', value: (stats.borrowRateBps / 100) + '% APR' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-lg font-semibold mt-1 ${stat.highlight ? 'text-black' : 'text-black'}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Position Card */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-black" />
            <h3 className="text-sm font-semibold text-black">Your Position</h3>
          </div>
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Collateral Deposited</span>
                <span className="text-black">{formatXLM(position.sxlmDeposited)} sXLM</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">XLM Borrowed</span>
                <span className="text-black">{formatXLM(position.xlmBorrowed)} XLM</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Health Factor</span>
                <span className={`font-bold ${
                  position.healthFactor > 1.5 ? 'text-green-600' :
                  position.healthFactor > 1.0 ? 'text-orange-500' : 'text-red-500'
                }`}>
                  {position.healthFactor > 0 ? position.healthFactor.toFixed(2) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Max Borrow</span>
                <span className="text-black">{formatXLM(position.maxBorrow)} XLM</span>
              </div>
            </div>
          )}

          {position.healthFactor > 0 && position.healthFactor < 1.2 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-red-600">
                Health factor is low. Consider repaying debt or adding collateral.
              </span>
            </div>
          )}
        </div>

        {/* Action Card */}
        <div className="card p-6 space-y-4">
          <div className="flex gap-1 bg-[#F5F5F5] rounded-xl p-1">
            {(['deposit', 'withdraw', 'borrow', 'repay', 'liquidate'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setAmount(''); setBorrowerAddress(''); clearError(); }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-black text-white'
                    : 'text-gray-500 hover:text-black'
                }`}
              >
                {tab === 'liquidate' ? (
                  <span className="flex items-center justify-center gap-1">
                    <Zap className="w-3 h-3" /> Liq.
                  </span>
                ) : (
                  tab.charAt(0).toUpperCase() + tab.slice(1)
                )}
              </button>
            ))}
          </div>

          {(activeTab === 'borrow' || activeTab === 'withdraw' || activeTab === 'repay') && position.sxlmDeposited === 0 && (
            <div className="rounded-xl p-3 text-xs bg-[#F5F5F5] border border-[#e5e5e5]">
              <p className="text-black font-medium mb-1">Step 1 required: Deposit sXLM first</p>
              <p className="text-gray-500">You have no collateral deposited. Switch to the <strong className="text-black">Deposit</strong> tab, deposit your sXLM, then come back to borrow.</p>
            </div>
          )}

          {activeTab === 'liquidate' ? (
            <div>
              <label className="label">Borrower Address to Liquidate</label>
              <input
                type="text"
                value={borrowerAddress}
                onChange={(e) => setBorrowerAddress(e.target.value)}
                placeholder="G..."
                className="input"
              />
              <p className="text-xs text-gray-500 mt-2">
                Liquidate positions with health factor below 1.0. You repay their debt and receive their collateral + 5% bonus.
              </p>
            </div>
          ) : (
            <div>
              <label className="label">
                {activeTab === 'deposit' || activeTab === 'withdraw' ? 'sXLM Amount' : 'XLM Amount'}
              </label>
              {activeTab === 'borrow' && position.maxBorrow > 0 && (
                <p className="text-xs text-gray-500 mb-1">Max: {position.maxBorrow.toFixed(4)} XLM</p>
              )}
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input font-mono"
              />
            </div>
          )}

          {error && (
            <div className="banner-error">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {lastTxHash && (
            <div className={isPending ? 'banner-warning space-y-1' : 'banner-success space-y-1'}>
              <p className={`text-xs ${isPending ? 'text-gray-700' : 'text-green-600'}`}>
                {isPending ? 'Transaction submitted — confirming on Stellar (may take a moment)' : 'Transaction successful!'}
              </p>
              <a
                href={`https://stellar.expert/explorer/public/tx/${lastTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[10px] font-mono truncate text-gray-500"
                style={{ opacity: 0.7 }}
              >
                {lastTxHash}
              </a>
            </div>
          )}

          {isConnected ? (
            <button
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                (activeTab === 'liquidate' ? !borrowerAddress : (!amount || parseFloat(amount) <= 0)) ||
                (['borrow', 'withdraw', 'repay'].includes(activeTab) && position.sxlmDeposited === 0)
              }
              className="w-full btn"
            >
              {isSubmitting ? 'Processing…' : buttonLabels[activeTab]}
            </button>
          ) : (
            <button onClick={connect} className="w-full btn">
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-black" />
          <h3 className="text-sm font-semibold text-black">How Lending Works</h3>
        </div>
        <div className="space-y-3 text-sm text-gray-500">
          <p>1. Deposit sXLM as collateral into the lending contract.</p>
          <p>2. Borrow up to {stats.collateralFactorBps / 100}% of your collateral value in XLM.</p>
          <p>3. Your Health Factor must stay above 1.0 to avoid liquidation.</p>
          <p>4. Repay your borrowed XLM to unlock your sXLM collateral.</p>
          <p>5. Liquidators can repay unhealthy positions and receive collateral + 5% bonus.</p>
          <p className="text-xs text-gray-400">
            Liquidation threshold: {stats.liquidationThresholdBps / 100}%. Borrow rate: {stats.borrowRateBps / 100}% APR.
          </p>
        </div>
      </div>
    </div>
  );
}
