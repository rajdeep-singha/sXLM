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
        <button
          onClick={connect}
          disabled={isConnecting}
          className="btn text-sm"
        >
          {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {error && <p className="text-xs text-red-500 max-w-[250px] text-right">{error}</p>}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border border-[#e5e5e5] bg-white hover:bg-gray-50 transition-colors duration-200"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block flex-shrink-0"
          style={{ boxShadow: '0 0 6px rgba(34,197,94,0.5)' }}
        />
        <span className="font-mono font-semibold text-black">
          {balance.sxlmBalance.toFixed(2)} sXLM
        </span>
        <span className="text-gray-300">|</span>
        <span className="font-mono text-gray-500">
          {formatAddress(publicKey || '')}
        </span>
      </button>

      {showDropdown && (
        <div
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl p-2 z-50 border border-[#e5e5e5] bg-white"
          style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.1)' }}
        >
          <div className="px-3 py-2 mb-1">
            <p className="text-[10px] mb-1 text-gray-400">Connected</p>
            <p className="font-mono text-[10px] break-all text-gray-500">{publicKey}</p>

            <div className="mt-2 pt-2 border-t border-[#e5e5e5]">
              <p className="text-[10px] mb-0.5 text-gray-400">sXLM Balance</p>
              <p className="font-mono text-base font-bold text-black">
                {balance.sxlmBalance.toFixed(4)}
                <span className="text-[10px] font-normal ml-1 text-gray-400">sXLM</span>
              </p>
              <p className="text-[10px] mt-0.5 text-gray-400">
                ≈ {balance.xlmValue.toFixed(4)} XLM value
              </p>
            </div>

            <div className="mt-2 pt-2 border-t border-[#e5e5e5] flex justify-between items-center">
              <p className="text-[10px] text-gray-400">XLM in Wallet</p>
              <p className="font-mono text-[11px] text-gray-500">
                {balance.xlmNativeBalance.toFixed(4)}
                <span className="text-[10px] ml-1 text-gray-400">XLM</span>
              </p>
            </div>
          </div>

          <button
            onClick={copyAddress}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:text-black transition-colors duration-150"
          >
            {copied
              ? <Check className="w-3 h-3 text-green-500" />
              : <Copy className="w-3 h-3" />
            }
            {copied ? 'Copied!' : 'Copy Address'}
          </button>

          <button
            onClick={() => { disconnect(); setShowDropdown(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-red-500 hover:bg-red-50 transition-colors duration-150"
          >
            <LogOut className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
