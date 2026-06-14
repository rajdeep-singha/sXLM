import { useState } from 'react';
import { Vote, Plus, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useGovernance } from '../hooks/useGovernance';
import { formatAddress } from '../utils/stellar';

function formatXLMVotes(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(0);
}

export default function Governance() {
  const { isConnected, connect } = useWallet();
  const {
    proposals,
    params,
    isLoading,
    isSubmitting,
    error,
    lastTxHash,
    createProposal,
    vote,
    executeProposal,
    clearError,
  } = useGovernance();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [paramKey, setParamKey] = useState('protocol_fee_bps');
  const [newValue, setNewValue] = useState('');

  const handleCreateProposal = async () => {
    if (!newValue) return;
    clearError();
    const success = await createProposal(paramKey, newValue);
    if (success) {
      setNewValue('');
      setShowCreateForm(false);
    }
  };

  const handleVote = async (proposalId: number, support: boolean) => {
    clearError();
    await vote(proposalId, support);
  };

  const handleExecute = async (proposalId: number) => {
    clearError();
    await executeProposal(proposalId);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 rounded-full text-xs bg-black text-white">Active</span>;
      case 'passed':
        return <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700 border border-green-200">Passed</span>;
      case 'rejected':
        return <span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-700 border border-red-200">Rejected</span>;
      case 'executed':
        return <span className="px-2 py-1 rounded-full text-xs bg-[#2B2644]/10 text-[#2B2644] border border-[#2B2644]/20">Executed</span>;
      default:
        return null;
    }
  };

  const activeCount = proposals.filter(p => p.status === 'active').length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">DAO</p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Governance</h1>
        <p className="text-sm text-gray-500">Vote on protocol parameter changes with sXLM</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Total Proposals</p>
          <p className="text-lg font-semibold text-black mt-1">{isLoading ? '…' : proposals.length}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Active Proposals</p>
          <p className="text-lg font-semibold text-black mt-1">{isLoading ? '…' : activeCount}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Quorum Required</p>
          <p className="text-lg font-semibold text-black mt-1">10%</p>
        </div>
      </div>

      {/* Governable Params */}
      {params.length > 0 && (
        <div className="card p-6 space-y-3">
          <h3 className="text-sm font-semibold text-black">Governable Parameters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {params.map((p) => (
              <div key={p.key} className="bg-[#F5F5F5] rounded-xl p-3">
                <p className="text-xs text-gray-500">{p.description}</p>
                <p className="text-sm text-black font-medium mt-1">{p.key}: <span className="font-semibold">{p.currentValue}</span></p>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="banner-error"><p className="text-xs text-red-500">{error}</p></div>}
      {lastTxHash && <div className="banner-success"><p className="text-xs text-green-600">Transaction successful!</p></div>}

      {/* Create Proposal */}
      <div className="flex justify-end">
        {isConnected ? (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 btn"
          >
            <Plus className="w-4 h-4" />
            Create Proposal
          </button>
        ) : (
          <button onClick={connect} className="btn">
            Connect Wallet to Propose
          </button>
        )}
      </div>

      {showCreateForm && (
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-black">New Proposal</h3>
          <div>
            <label className="label">Parameter</label>
            <select
              value={paramKey}
              onChange={(e) => setParamKey(e.target.value)}
              className="input"
            >
              {params.map((p) => (
                <option key={p.key} value={p.key}>{p.description} ({p.key})</option>
              ))}
              {params.length === 0 && (
                <>
                  <option value="protocol_fee_bps">Protocol Fee (bps)</option>
                  <option value="cooldown_period">Cooldown Period (ledgers)</option>
                  <option value="collateral_factor">Collateral Factor (bps)</option>
                  <option value="buffer_safety_factor">Buffer Safety Factor</option>
                </>
              )}
            </select>
          </div>
          <div>
            <label className="label">New Value</label>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Enter new value"
              className="input"
            />
          </div>
          <p className="text-xs text-gray-500">Minimum 100 sXLM balance required to create a proposal.</p>
          <button
            onClick={handleCreateProposal}
            disabled={isSubmitting || !newValue}
            className="w-full btn"
          >
            {isSubmitting ? 'Submitting…' : 'Submit Proposal'}
          </button>
        </div>
      )}

      {/* Proposals List */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-black flex items-center gap-2">
          <Vote className="w-4 h-4" />
          Proposals
        </h3>

        {isLoading ? (
          <p className="text-sm text-gray-500">Loading proposals…</p>
        ) : proposals.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-gray-500">No proposals yet. Be the first to create one!</p>
          </div>
        ) : (
          proposals.map((proposal) => {
            const votesFor = Number(proposal.votesFor) / 1e7;
            const votesAgainst = Number(proposal.votesAgainst) / 1e7;
            const totalVotes = votesFor + votesAgainst;
            const forPercent = totalVotes > 0 ? (votesFor / totalVotes) * 100 : 50;

            return (
              <div key={proposal.id} className="card p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-black font-medium text-sm">
                        #{proposal.id}: Change {proposal.paramKey}
                      </span>
                      {getStatusBadge(proposal.status)}
                    </div>
                    <p className="text-xs text-gray-500">
                      Proposed by {formatAddress(proposal.proposer)} · New value: <span className="text-black font-medium">{proposal.newValue}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {proposal.status === 'active' ? 'Voting' : proposal.status}
                  </div>
                </div>

                {/* Vote Bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      For: {formatXLMVotes(votesFor)} ({forPercent.toFixed(0)}%)
                    </span>
                    <span className="text-red-500 flex items-center gap-1">
                      Against: {formatXLMVotes(votesAgainst)} ({(100 - forPercent).toFixed(0)}%)
                      <XCircle className="w-3 h-3" />
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#e5e5e5] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${forPercent}%` }}
                    />
                  </div>
                </div>

                {proposal.status === 'active' && isConnected && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVote(proposal.id, true)}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors text-sm font-medium disabled:opacity-40"
                    >
                      {isSubmitting ? '…' : 'Vote For'}
                    </button>
                    <button
                      onClick={() => handleVote(proposal.id, false)}
                      disabled={isSubmitting}
                      className="flex-1 py-2 rounded-xl bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors text-sm font-medium disabled:opacity-40"
                    >
                      {isSubmitting ? '…' : 'Vote Against'}
                    </button>
                  </div>
                )}

                {proposal.status === 'passed' && !proposal.executed && isConnected && (
                  <button
                    onClick={() => handleExecute(proposal.id)}
                    disabled={isSubmitting}
                    className="w-full py-2 rounded-xl bg-[#2B2644]/10 text-[#2B2644] border border-[#2B2644]/20 hover:bg-[#2B2644]/15 transition-colors text-sm font-medium disabled:opacity-40"
                  >
                    {isSubmitting ? 'Executing…' : 'Execute Proposal'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
