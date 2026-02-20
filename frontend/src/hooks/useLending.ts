import { useState, useCallback, useEffect } from 'react';
import axios from '../lib/apiClient';
import { API_BASE_URL } from '../config/contracts';
import { useWallet } from './useWallet';

interface LendingPosition {
  sxlmDeposited: number;
  xlmBorrowed: number;
  healthFactor: number;
  maxBorrow: number;
}

interface LendingStats {
  totalCollateral: number;
  totalBorrowed: number;
  collateralFactorBps: number;
  liquidationThresholdBps: number;
  borrowRateBps: number;
  utilizationRate: number;
}

interface UseLendingReturn {
  position: LendingPosition;
  stats: LendingStats;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  lastTxHash: string | null;
  depositCollateral: (amount: number) => Promise<boolean>;
  withdrawCollateral: (amount: number) => Promise<boolean>;
  borrow: (amount: number) => Promise<boolean>;
  repay: (amount: number) => Promise<boolean>;
  liquidate: (borrowerAddress: string) => Promise<boolean>;
  clearError: () => void;
  refresh: () => Promise<void>;
}

const DEFAULT_POSITION: LendingPosition = {
  sxlmDeposited: 0,
  xlmBorrowed: 0,
  healthFactor: 0,
  maxBorrow: 0,
};

const DEFAULT_STATS: LendingStats = {
  totalCollateral: 0,
  totalBorrowed: 0,
  collateralFactorBps: 7000,
  liquidationThresholdBps: 8000,
  borrowRateBps: 500,
  utilizationRate: 0,
};

export function useLending(): UseLendingReturn {
  const { publicKey, isConnected, signTransaction, getAuthHeaders } = useWallet();
  const [position, setPosition] = useState<LendingPosition>(DEFAULT_POSITION);
  const [stats, setStats] = useState<LendingStats>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, posRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/lending/stats`),
        publicKey
          ? axios.get(`${API_BASE_URL}/api/lending/position/${publicKey}`)
          : Promise.resolve(null),
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value) {
        setStats(statsRes.value.data);
      }
      if (posRes.status === 'fulfilled' && posRes.value?.data) {
        setPosition(posRes.value.data);
      }
    } catch {
      // Keep defaults
    }
    setIsLoading(false);
  }, [publicKey]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const submitContractTx = useCallback(
    async (endpoint: string, payload: Record<string, unknown>): Promise<boolean> => {
      if (!isConnected || !publicKey) {
        setError('Please connect your wallet first');
        return false;
      }

      setIsSubmitting(true);
      setError(null);
      setLastTxHash(null);

      try {
        // Step 1: Build unsigned tx
        const { data: txData } = await axios.post(
          `${API_BASE_URL}/api/lending/${endpoint}`,
          { userAddress: publicKey, ...payload },
          { headers: getAuthHeaders() }
        );

        if (txData.xdr) {
          // Step 2: Sign with Freighter
          const signedXdr = await signTransaction(txData.xdr, txData.networkPassphrase);

          // Step 3: Submit
          const { data: submitData } = await axios.post(
            `${API_BASE_URL}/api/staking/submit`,
            { signedXdr },
            { headers: getAuthHeaders() }
          );

          setLastTxHash(submitData.txHash);
        }

        await fetchData();
        setIsSubmitting(false);
        return true;
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : err instanceof Error
              ? err.message
              : 'Transaction failed';
        setError(message);
        setIsSubmitting(false);
        return false;
      }
    },
    [isConnected, publicKey, signTransaction, getAuthHeaders, fetchData]
  );

  const depositCollateral = useCallback(
    (amount: number) => submitContractTx('deposit-collateral', { amount }),
    [submitContractTx]
  );

  const withdrawCollateral = useCallback(
    (amount: number) => submitContractTx('withdraw-collateral', { amount }),
    [submitContractTx]
  );

  const borrow = useCallback(
    (amount: number) => submitContractTx('borrow', { amount }),
    [submitContractTx]
  );

  const repay = useCallback(
    (amount: number) => submitContractTx('repay', { amount }),
    [submitContractTx]
  );

  const liquidate = useCallback(
    async (borrowerAddress: string): Promise<boolean> => {
      if (!isConnected || !publicKey) {
        setError('Please connect your wallet first');
        return false;
      }

      setIsSubmitting(true);
      setError(null);
      setLastTxHash(null);

      try {
        const { data: txData } = await axios.post(
          `${API_BASE_URL}/api/lending/liquidate`,
          { liquidatorAddress: publicKey, borrowerAddress },
          { headers: getAuthHeaders() }
        );

        if (txData.xdr) {
          const signedXdr = await signTransaction(txData.xdr, txData.networkPassphrase);
          const { data: submitData } = await axios.post(
            `${API_BASE_URL}/api/staking/submit`,
            { signedXdr },
            { headers: getAuthHeaders() }
          );
          setLastTxHash(submitData.txHash);
        }

        await fetchData();
        setIsSubmitting(false);
        return true;
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : err instanceof Error
              ? err.message
              : 'Liquidation failed';
        setError(message);
        setIsSubmitting(false);
        return false;
      }
    },
    [isConnected, publicKey, signTransaction, getAuthHeaders, fetchData]
  );

  return {
    position,
    stats,
    isLoading,
    isSubmitting,
    error,
    lastTxHash,
    depositCollateral,
    withdrawCollateral,
    borrow,
    repay,
    liquidate,
    clearError,
    refresh: fetchData,
  };
}
