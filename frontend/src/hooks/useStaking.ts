import { useState, useCallback, useEffect } from 'react';
import axios from '../lib/apiClient';
import { API_BASE_URL } from '../config/contracts';
import { useWallet } from './useWallet';

interface StakingState {
  isStaking: boolean;
  isUnstaking: boolean;
  isClaiming: boolean;
  error: string | null;
  lastTxHash: string | null;
}

interface BalanceInfo {
  sxlmBalance: number;
  xlmValue: number;
  exchangeRate: number;
  archived?: boolean;
}

interface PendingWithdrawal {
  id: string;
  wallet: string;
  amount: string;
  status: string;
  unlockTime: string;
  createdAt: string;
}

interface UseStakingReturn extends StakingState {
  stake: (xlmAmount: number) => Promise<boolean>;
  unstake: (sxlmAmount: number, instant?: boolean) => Promise<boolean>;
  claimWithdrawal: (withdrawalId: string) => Promise<boolean>;
  pendingWithdrawals: PendingWithdrawal[];
  fetchPendingWithdrawals: () => Promise<void>;
  clearError: () => void;
  balance: BalanceInfo;
  refreshBalance: () => Promise<void>;
}

export function useStaking(): UseStakingReturn {
  const { publicKey, isConnected, signTransaction, getAuthHeaders } = useWallet();
  const [state, setState] = useState<StakingState>({
    isStaking: false,
    isUnstaking: false,
    isClaiming: false,
    error: null,
    lastTxHash: null,
  });
  const [pendingWithdrawals, setPendingWithdrawals] = useState<PendingWithdrawal[]>([]);
  const [balance, setBalance] = useState<BalanceInfo>({ sxlmBalance: 0, xlmValue: 0, exchangeRate: 1 });

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/balance/${publicKey}`);
      setBalance({
        sxlmBalance: data.sxlmBalance,
        xlmValue: data.xlmValue,
        exchangeRate: data.exchangeRate,
        archived: data.archived ?? false,
      });
    } catch {
      // silently fail
    }
  }, [publicKey]);

  // Auto-fetch balance when wallet connects
  useEffect(() => {
    if (isConnected && publicKey) {
      refreshBalance();
    }
  }, [isConnected, publicKey, refreshBalance]);

  const stake = useCallback(
    async (xlmAmount: number): Promise<boolean> => {
      if (!isConnected || !publicKey) {
        setState((prev) => ({ ...prev, error: 'Please connect your wallet first' }));
        return false;
      }

      setState((prev) => ({ ...prev, isStaking: true, error: null }));

      try {
        // Step 1: Get unsigned transaction XDR from backend
        const { data: txData } = await axios.post(
          `${API_BASE_URL}/api/staking/stake`,
          { userAddress: publicKey, amount: xlmAmount },
          { headers: getAuthHeaders() }
        );

        if (txData.xdr) {
          // Step 2: Sign with Freighter
          const signedXdr = await signTransaction(txData.xdr, txData.networkPassphrase);

          // Step 3: Submit signed tx back to backend
          const { data: submitData } = await axios.post(
            `${API_BASE_URL}/api/staking/submit`,
            { signedXdr },
            { headers: getAuthHeaders() }
          );

          setState((prev) => ({
            ...prev,
            isStaking: false,
            lastTxHash: submitData.txHash,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isStaking: false,
            lastTxHash: txData.txHash || null,
          }));
        }

        // Refresh balance after staking
        await refreshBalance();
        return true;
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : err instanceof Error
              ? err.message
              : 'Staking failed';
        setState((prev) => ({ ...prev, isStaking: false, error: message }));
        return false;
      }
    },
    [isConnected, publicKey, signTransaction, getAuthHeaders, refreshBalance]
  );

  const unstake = useCallback(
    async (sxlmAmount: number, instant: boolean = false): Promise<boolean> => {
      if (!isConnected || !publicKey) {
        setState((prev) => ({ ...prev, error: 'Please connect your wallet first' }));
        return false;
      }

      setState((prev) => ({ ...prev, isUnstaking: true, error: null }));

      try {
        const { data: txData } = await axios.post(
          `${API_BASE_URL}/api/staking/unstake`,
          { userAddress: publicKey, amount: sxlmAmount, instant },
          { headers: getAuthHeaders() }
        );

        if (txData.xdr) {
          const signedXdr = await signTransaction(txData.xdr, txData.networkPassphrase);
          const { data: submitData } = await axios.post(
            `${API_BASE_URL}/api/staking/submit`,
            { signedXdr },
            { headers: getAuthHeaders() }
          );

          setState((prev) => ({
            ...prev,
            isUnstaking: false,
            lastTxHash: submitData.txHash,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isUnstaking: false,
            lastTxHash: txData.txHash || null,
          }));
        }

        // Refresh balance after unstaking
        await refreshBalance();
        return true;
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : err instanceof Error
              ? err.message
              : 'Unstaking failed';
        setState((prev) => ({ ...prev, isUnstaking: false, error: message }));
        return false;
      }
    },
    [isConnected, publicKey, signTransaction, getAuthHeaders, refreshBalance]
  );

  const claimWithdrawal = useCallback(
    async (withdrawalId: string): Promise<boolean> => {
      if (!isConnected || !publicKey) {
        setState((prev) => ({ ...prev, error: 'Please connect your wallet first' }));
        return false;
      }

      setState((prev) => ({ ...prev, isClaiming: true, error: null }));

      try {
        // Step 1: Get unsigned claim tx
        const { data: txData } = await axios.post(
          `${API_BASE_URL}/api/staking/claim`,
          { userAddress: publicKey, withdrawalId },
          { headers: getAuthHeaders() }
        );

        if (txData.xdr) {
          // Step 2: Sign and submit
          const signedXdr = await signTransaction(txData.xdr, txData.networkPassphrase);
          await axios.post(
            `${API_BASE_URL}/api/staking/submit`,
            { signedXdr },
            { headers: getAuthHeaders() }
          );
        }

        setState((prev) => ({ ...prev, isClaiming: false }));
        // Refresh withdrawals inline to avoid stale closure
        try {
          const { data } = await axios.get(
            `${API_BASE_URL}/api/staking/withdrawals/${publicKey}`,
            { headers: getAuthHeaders() }
          );
          setPendingWithdrawals(data.withdrawals || []);
        } catch {
          // Silently fail
        }
        return true;
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : err instanceof Error
              ? err.message
              : 'Claim failed';
        setState((prev) => ({ ...prev, isClaiming: false, error: message }));
        return false;
      }
    },
    [isConnected, publicKey, signTransaction, getAuthHeaders]
  );

  const fetchPendingWithdrawals = useCallback(async () => {
    if (!publicKey) return;
    try {
      const { data } = await axios.get(
        `${API_BASE_URL}/api/staking/withdrawals/${publicKey}`,
        { headers: getAuthHeaders() }
      );
      setPendingWithdrawals(data.withdrawals || []);
    } catch {
      // Silently fail — withdrawals will show as empty
    }
  }, [publicKey, getAuthHeaders]);

  return {
    ...state,
    stake,
    unstake,
    claimWithdrawal,
    pendingWithdrawals,
    fetchPendingWithdrawals,
    clearError,
    balance,
    refreshBalance,
  };
}
