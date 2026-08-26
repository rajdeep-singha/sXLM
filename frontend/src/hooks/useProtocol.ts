import { useState, useEffect, useCallback } from "react";
import axios from "../lib/apiClient";
import { API_BASE_URL } from "../config/contracts";

interface ProtocolStats {
  totalStaked: number;
  totalSxlmSupply: number;
  exchangeRate: number;
  tvlUsd: number;
  totalStakers: number;
  xlmPrice: number;
  treasuryBalance: number;
  isPaused: boolean;
  protocolFeePct: number;
}

interface APYData {
  currentApr: number;
  currentApy: number;
  apy7d: number;
  apy30d: number;
  apy90d: number;
}

interface HistoricalDataPoint {
  timestamp: string;
  value: number;
}

interface UseProtocolReturn {
  stats: ProtocolStats;
  apy: APYData;
  apyHistory: HistoricalDataPoint[];
  exchangeRateHistory: HistoricalDataPoint[];
  tvlHistory: HistoricalDataPoint[];
  totalStakedHistory: HistoricalDataPoint[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_STATS: ProtocolStats = {
  totalStaked: 0,
  totalSxlmSupply: 0,
  exchangeRate: 1.0,
  tvlUsd: 0,
  totalStakers: 0,
  xlmPrice: 0.12,
  treasuryBalance: 0,
  isPaused: false,
  protocolFeePct: 10,
};

const DEFAULT_APY: APYData = {
  currentApr: 0,
  currentApy: 0,
  apy7d: 0,
  apy30d: 0,
  apy90d: 0,
};

export function useProtocol(): UseProtocolReturn {
  const [stats, setStats] = useState<ProtocolStats>(DEFAULT_STATS);
  const [apy, setApy] = useState<APYData>(DEFAULT_APY);
  const [apyHistory, setApyHistory] = useState<HistoricalDataPoint[]>([]);
  const [exchangeRateHistory, setExchangeRateHistory] = useState<
    HistoricalDataPoint[]
  >([]);
  const [tvlHistory, setTvlHistory] = useState<HistoricalDataPoint[]>([]);
  const [totalStakedHistory, setTotalStakedHistory] = useState<
    HistoricalDataPoint[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProtocolData = useCallback(async () => {
    try {
      const [statsRes, apyRes, chartRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/protocol-stats`),
        axios.get(`${API_BASE_URL}/api/apy`),
        axios.get(`${API_BASE_URL}/api/chart-data?days=90`),
      ]);

      if (statsRes.status === "fulfilled") {
        setStats(statsRes.value.data);
      }

      if (apyRes.status === "fulfilled") {
        setApy(apyRes.value.data);
      }

      // Chart history comes from the backend or not at all. An empty chart is
      // an honest empty chart; invented history is a claim about performance
      // that never happened.
      if (chartRes.status === "fulfilled" && chartRes.value.data) {
        const chart = chartRes.value.data;
        setApyHistory(chart.apyHistory ?? []);
        setExchangeRateHistory(chart.exchangeRateHistory ?? []);
        setTvlHistory(chart.tvlHistory ?? []);
        setTotalStakedHistory(chart.totalStakedHistory ?? []);
      } else {
        setApyHistory([]);
        setExchangeRateHistory([]);
        setTvlHistory([]);
        setTotalStakedHistory([]);
      }

      setError(null);
    } catch {
      setError("Failed to fetch protocol data. Backend may be offline.");
      // Show zeros instead of fake data — no misleading numbers
      setStats(DEFAULT_STATS);
      setApy(DEFAULT_APY);
      setApyHistory([]);
      setExchangeRateHistory([]);
      setTvlHistory([]);
      setTotalStakedHistory([]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchProtocolData();
    const interval = setInterval(fetchProtocolData, 60_000);
    return () => clearInterval(interval);
  }, [fetchProtocolData]);

  return {
    stats,
    apy,
    apyHistory,
    exchangeRateHistory,
    tvlHistory,
    totalStakedHistory,
    isLoading,
    error,
    refresh: fetchProtocolData,
  };
}
