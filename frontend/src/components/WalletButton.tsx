import { useState, useRef, useEffect } from 'react';
import { LogOut, Copy, Check } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useStaking } from '../hooks/useStaking';
import { formatAddress } from '../utils/stellar';

export default function WalletButton() {
  const { publicKey, isConnected, isConnecting, error, connect, disconnect } = useWallet();
  const { balance } = useStaking();
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const copyAddress = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={connect} disabled={isConnecting} className="btn text-xs">
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
        {error && <p className="text-xs text-red-400 max-w-[250px] text-right">{error}</p>}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-surface transition-colors"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
        <span className="font-mono text-neutral-300">{formatAddress(publicKey || '')}</span>
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-56 card p-2 shadow-2xl shadow-black/80 z-50">
          <div className="px-3 py-2 mb-1">
            <p className="text-[10px] text-neutral-500 mb-1">Connected</p>
            <p className="font-mono text-[10px] text-neutral-400 break-all">{publicKey}</p>
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-[10px] text-neutral-500 mb-0.5">sXLM Balance</p>
              <p className="font-mono text-sm font-semibold text-white">
                {balance.sxlmBalance.toFixed(4)}
                <span className="text-neutral-500 text-[10px] font-normal ml-1">sXLM</span>
              </p>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                ≈ {balance.xlmValue.toFixed(4)} XLM
              </p>
            </div>
          </div>
          <button
            onClick={copyAddress}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-neutral-400 hover:bg-white/5 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy Address'}
          </button>
          <button
            onClick={() => { disconnect(); setShowDropdown(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-red-400 hover:bg-red-500/5 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
