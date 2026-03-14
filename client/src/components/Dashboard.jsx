import React, { useState, useEffect } from 'react';
import { FiRefreshCw, FiArrowRight, FiActivity, FiPlus, FiX, FiChevronDown, FiTrash2 } from 'react-icons/fi';
import axios from 'axios';
import API_BASE from '../config';

const Dashboard = () => {
  const [transactions, setTransactions] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [expandedTxIds, setExpandedTxIds] = useState([]);

  const toggleExpand = (id) => {
    setExpandedTxIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  const [currentUserId, setCurrentUserId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showMockForm, setShowMockForm] = useState(false);
  const [mockForm, setMockForm] = useState({ 
    name: '', 
    amount: '', 
    category: 'General',
    date: new Date().toISOString().split('T')[0],
    selectedGroupId: '',
    splitMethod: 'equally',
    payerId: '',
    includedMembers: [],
    memberValues: {}
  });

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/splitwise/status`);
      setIsConnected(res.data.connected);
      
      if (res.data.connected) {
        const userRes = await axios.get(`${API_BASE}/api/splitwise/current_user`);
        setCurrentUserId(userRes.data.user?.id);
      }
    } catch (error) {
      console.error("Error checking status", error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/transactions/`);
      // Reconcile field names and initialize defaults if needed
      const reconciled = res.data.map(tx => ({
        ...tx,
        selectedGroupId: tx.selectedGroupId || tx.splitwise_group_id || "",
        splitMethod: tx.splitMethod || "equally",
        includedMembers: tx.includedMembers || []
      }));
      setTransactions(reconciled);
    } catch (error) {
      console.error("Error fetching transactions", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/splitwise/groups`);
      const userRes = await axios.get(`${API_BASE}/api/splitwise/current_user`);
      const myId = userRes.data.user?.id;
      setCurrentUserId(myId);

      if (res.data && res.data.groups) {
        const groupsWithMetadata = res.data.groups.map(g => {
          const me = g.members?.find(m => m.id === myId);
          const balance = me?.balance?.reduce((acc, b) => acc + parseFloat(b.amount), 0) || 0;
          
          return {
            ...g,
            balance: balance,
            absBalance: Math.abs(balance),
            isActive: Math.abs(balance) > 0.01
          };
        });

        const sortedGroups = groupsWithMetadata.sort((a, b) => b.absBalance - a.absBalance);
        setGroups(sortedGroups);
      }
    } catch (error) {
      console.error("Error fetching groups", error);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchTransactions();
    fetchGroups();
  }, []);

  const handleSyncBank = async () => {
    setIsSyncing(true);
    try {
      await axios.get(`${API_BASE}/api/transactions/sync`);
      await fetchTransactions();
    } catch (error) {
       console.error("Error syncing with Plaid", error);
       alert("Failed to sync. Make sure Plaid is connected in settings.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddManual = async (e) => {
    e.preventDefault();
    if (!mockForm.name || !mockForm.amount) return;
    
    try {
      await axios.post(`${API_BASE}/api/transactions/mock`, {
        ...mockForm,
        amount: parseFloat(mockForm.amount)
      });
      setMockForm({ 
        name: '', 
        amount: '', 
        category: 'General',
        date: new Date().toISOString().split('T')[0]
      });
      setShowMockForm(false);
      await fetchTransactions();
    } catch (error) {
      console.error("Error adding manual transaction", error);
      alert("Failed to add transaction.");
    }
  };

  const handleManualPush = async (e) => {
    e.preventDefault();
    if (!mockForm.name || !mockForm.amount || !mockForm.selectedGroupId) {
      alert("Please fill in Merchant, Amount, and select a Group.");
      return;
    }

    try {
      // First, save to local DB so we have a record
      const res = await axios.post(`${API_BASE}/api/transactions/mock`, {
        ...mockForm,
        amount: parseFloat(mockForm.amount)
      });
      const newTxId = res.data.id || res.data.transaction_id;

      // Then push to Splitwise (reusing push logic)
      const mockTxForPush = {
        ...mockForm,
        id: newTxId,
        amount: parseFloat(mockForm.amount)
      };
      
      await handlePushToSplitwise(newTxId, mockTxForPush);
      
      // Cleanup
      setMockForm({ 
        name: '', 
        amount: '', 
        category: 'General',
        date: new Date().toISOString().split('T')[0],
        selectedGroupId: '',
        splitMethod: 'equally',
        payerId: '',
        includedMembers: [],
        memberValues: {}
      });
      setShowMockForm(false);
      await fetchTransactions();
    } catch (error) {
      console.error("Error in manual push", error);
      alert(`Failed to push manual transaction: ${error.message}`);
    }
  };

  const handleGroupSelect = (id, groupId) => {
    const group = groups.find(g => g.id.toString() === groupId.toString());
    const memberIds = group?.members?.map(m => m.id) || [];
    
    setTransactions(prev => prev.map(t => 
      t.id === id ? { 
        ...t, 
        selectedGroupId: groupId,
        includedMembers: memberIds
      } : t
    ));
  };

  const handleTxChange = (id, field, value) => {
    setTransactions(prev => prev.map(t => 
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const handlePushToSplitwise = async (id, tx) => {
    if (!tx.selectedGroupId) {
      alert("Please select a group first");
      return;
    }

    try {
      const group = groups.find(g => g.id.toString() === tx.selectedGroupId.toString());
      if (!group) throw new Error("Group not found");

      let payload = {
        cost: tx.amount,
        description: tx.name,
        group_id: tx.selectedGroupId,
        date: tx.displayDate || tx.date
      };

      const splitMethod = tx.splitMethod || 'equally';
      const payerId = tx.payerId || currentUserId;
      const includedIds = tx.includedMembers || group.members?.map(m => m.id) || [];
      const includedMembers = group.members?.filter(m => includedIds.includes(m.id)) || [];

      if (includedMembers.length === 0) throw new Error("At least one member must be selected for the split");

      if (splitMethod === 'equally') {
        const share = tx.amount / includedMembers.length;
        payload.split_equally = false;
        payload.users = group.members.map(m => ({
          user_id: m.id,
          paid_share: m.id.toString() === payerId.toString() ? tx.amount.toString() : "0.00",
          owed_share: includedIds.includes(m.id) ? share.toFixed(2) : "0.00"
        }));
      } else if (splitMethod === 'share' || splitMethod === 'custom') {
        payload.split_equally = false;
        const memberValues = tx.memberValues || {};
        
        if (splitMethod === 'share') {
          const totalShares = includedMembers.reduce((acc, m) => acc + (parseFloat(memberValues[m.id]) || 0), 0);
          if (totalShares === 0) throw new Error("Total shares for selected members cannot be zero");
          
          payload.users = group.members.map(m => {
            const isIncluded = includedIds.includes(m.id);
            const myShareCount = isIncluded ? (parseFloat(memberValues[m.id]) || 0) : 0;
            const myOwedAmount = isIncluded ? (tx.amount * myShareCount) / totalShares : 0;
            return {
              user_id: m.id,
              paid_share: m.id.toString() === payerId.toString() ? tx.amount.toString() : "0.00",
              owed_share: myOwedAmount.toFixed(2)
            };
          });
        } else {
          payload.users = group.members.map(m => {
            const isIncluded = includedIds.includes(m.id);
            return {
              user_id: m.id,
              paid_share: m.id.toString() === payerId.toString() ? tx.amount.toString() : "0.00",
              owed_share: isIncluded ? (parseFloat(memberValues[m.id]) || 0).toFixed(2) : "0.00"
            };
          });
          
          const totalOwed = payload.users.reduce((acc, u) => acc + parseFloat(u.owed_share), 0);
          if (Math.abs(totalOwed - tx.amount) > 0.05) {
            if (!confirm(`Total split ($${totalOwed.toFixed(2)}) doesn't match total amount ($${tx.amount.toFixed(2)}). Push anyway?`)) return;
          }
        }
      }
      
      await axios.post(`${API_BASE}/api/splitwise/expense`, payload);
      setTransactions(prev => prev.filter(t => t.id !== id));
      alert("Successfully pushed to Splitwise!");
      
    } catch (error) {
      console.error("Error pushing to Splitwise", error);
      alert(`Failed to push: ${error.message || 'Check console.'}`);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation(); // Don't toggle expand when clicking delete
    if (!confirm("Are you sure you want to delete this transaction? It will be removed from your dashboard.")) return;
    
    try {
      await axios.delete(`${API_BASE}/api/transactions/${id}`);
      setTransactions(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error("Error deleting transaction", error);
      alert("Failed to delete transaction.");
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '4rem' }}><FiRefreshCw className="spin" size={32} /></div>;
  }

  return (
    <div className="app-container animate-up">
      <div className="nav-header">
        <div className="nav-brand">
          <FiActivity style={{ color: 'var(--primary)' }} />
          Expense Tracker
        </div>
        <div className="nav-links">
           <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: isConnected ? '#10b981' : '#ef4444',
              boxShadow: isConnected ? '0 0 8px #10b981' : '0 0 8px #ef4444'
            }}></span>
            <span style={{ color: isConnected ? '#10b981' : '#ef4444', fontWeight: '600' }}>
              {isConnected ? 'Splitwise Connected' : 'Splitwise Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <div>
          <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Overview</h2>
          <p className="subtitle" style={{ marginBottom: '1rem' }}>Review and push your latest bank transactions to Splitwise.</p>
        </div>
        <div className="tx-controls-row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginRight: '0.5rem', fontSize: '0.9rem' }}>
            <input 
              type="checkbox" 
              id="activeGroupsOnly" 
              className="glass-checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
              style={{ cursor: 'pointer', width: '1.2rem', height: '1.2rem' }}
            />
            <label htmlFor="activeGroupsOnly" style={{ cursor: 'pointer', opacity: 0.8, fontWeight: '500' }}>Balance Only</label>
          </div>
          <button className="btn" onClick={() => setShowMockForm(!showMockForm)}>
            {showMockForm ? <FiX /> : <FiPlus />} {showMockForm ? 'Cancel' : 'Add Manually'}
          </button>
          <button className="btn btn-primary" onClick={handleSyncBank} disabled={isSyncing}>
            <FiRefreshCw className={isSyncing ? 'spin' : ''} /> 
            {isSyncing ? 'Pulling...' : 'Sync Bank'}
          </button>
        </div>
      </div>

      {showMockForm && (
        <div className="glass-card animate-up" style={{ marginBottom: '3rem', padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>New Manual Transaction</h3>
          <form onSubmit={handleAddManual}>
            <div className="tx-fields-grid">
              <div>
                <label className="field-label">Merchant</label>
                <input 
                  type="text" 
                  className="glass-input" 
                  placeholder="Starbucks"
                  value={mockForm.name}
                  onChange={(e) => setMockForm({...mockForm, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="field-label">Amount ($)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="glass-input" 
                  placeholder="0.00"
                  value={mockForm.amount}
                  onChange={(e) => setMockForm({...mockForm, amount: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="field-label">Category</label>
                <select 
                  className="glass-select"
                  value={mockForm.category}
                  onChange={(e) => setMockForm({...mockForm, category: e.target.value})}
                >
                  <option value="General">General</option>
                  <option value="Food">Food & Drink</option>
                  <option value="Transport">Travel</option>
                  <option value="Entertainment">Entertainment</option>
                </select>
              </div>
              <div>
                <label className="field-label">Date</label>
                <input 
                  type="date" 
                  className="glass-input" 
                  style={{ colorScheme: 'dark' }}
                  value={mockForm.date}
                  onChange={(e) => setMockForm({...mockForm, date: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="tx-fields-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'flex-end', marginTop: '1.5rem' }}>
              <div>
                <label className="field-label">Splitwise Group</label>
                <select 
                  className="glass-select"
                  value={mockForm.selectedGroupId || ""}
                  onChange={(e) => {
                    const groupId = e.target.value;
                    const group = groups.find(g => g.id.toString() === groupId.toString());
                    const memberIds = group?.members?.map(m => m.id) || [];
                    setMockForm({...mockForm, selectedGroupId: groupId, includedMembers: memberIds});
                  }}
                >
                  <option value="" disabled>Select Group...</option>
                  <optgroup label="Outstanding Balance">
                    {groups.filter(g => g.isActive).map(g => (
                      <option key={g.id} value={g.id} style={{ color: g.balance > 0 ? '#10b981' : '#ef4444' }}>
                        {g.name} ({g.balance > 0 ? '+' : ''}{g.balance.toFixed(2)})
                      </option>
                    ))}
                  </optgroup>
                  {!showActiveOnly && (
                    <optgroup label="Other Groups">
                      {groups.filter(g => !g.isActive).map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="field-label">Split Method</label>
                <select 
                  className="glass-select"
                  value={mockForm.splitMethod || 'equally'}
                  onChange={(e) => setMockForm({...mockForm, splitMethod: e.target.value})}
                >
                  <option value="equally">Equally</option>
                  <option value="share">By Share</option>
                  <option value="custom">Custom Amounts</option>
                </select>
              </div>

              <div>
                <label className="field-label">Who Paid?</label>
                <select 
                  className="glass-select"
                  value={mockForm.payerId || currentUserId || ""}
                  onChange={(e) => setMockForm({...mockForm, payerId: e.target.value})}
                >
                  {groups.find(g => g.id.toString() === mockForm.selectedGroupId?.toString())?.members?.map(m => (
                    <option key={m.id} value={m.id}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</option>
                  ))}
                  {!mockForm.selectedGroupId && <option disabled>Select a group first</option>}
                </select>
              </div>
            </div>

            {mockForm.selectedGroupId && (
              <div className="animate-fade-in" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-light)' }}>
                <div className="field-label" style={{ marginBottom: '1rem', color: 'var(--primary)', fontWeight: '600' }}>
                  Who's Included in this split?
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {groups.find(g => g.id.toString() === mockForm.selectedGroupId?.toString())?.members?.map(m => (
                    <label key={m.id} className="member-label" style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.6rem', 
                      cursor: 'pointer', 
                      background: (mockForm.includedMembers || []).some(id => id.toString() === m.id.toString()) ? 'hsla(250, 89%, 65%, 0.1)' : 'hsla(0,0%,100%,0.03)', 
                      padding: '0.6rem 1.1rem', 
                      borderRadius: '12px', 
                      border: (mockForm.includedMembers || []).some(id => id.toString() === m.id.toString()) ? '1px solid var(--primary-glow)' : '1px solid var(--border-light)', 
                      transition: 'var(--transition-smooth)' 
                    }}>
                      <input 
                        type="checkbox" 
                        className="glass-checkbox"
                        checked={(mockForm.includedMembers || []).some(id => id.toString() === m.id.toString())}
                        onChange={(e) => {
                          const current = mockForm.includedMembers || [];
                          const next = e.target.checked 
                            ? [...current, m.id] 
                            : current.filter(id => id.toString() !== m.id.toString());
                          setMockForm({...mockForm, includedMembers: next});
                        }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '500', color: (mockForm.includedMembers || []).some(id => id.toString() === m.id.toString()) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}
                      </span>
                    </label>
                  ))}
                </div>

                {(mockForm.splitMethod === 'share' || mockForm.splitMethod === 'custom') && (
                  <div className="animate-up" style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'hsla(0,0%,0%,0.15)', borderRadius: '16px', border: '1px solid var(--border-light)' }}>
                    <div className="field-label" style={{ marginBottom: '1rem' }}>
                      {mockForm.splitMethod === 'share' ? 'Specify Shares' : 'Exact Dollar Amounts'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '1rem' }}>
                      {groups.find(g => g.id.toString() === mockForm.selectedGroupId?.toString())?.members?.filter(m => (mockForm.includedMembers || []).some(id => id.toString() === m.id.toString())).map(m => (
                        <div key={m.id}>
                          <label className="field-label" style={{ fontSize: '0.65rem' }}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</label>
                          <input 
                            type="number"
                            className="glass-input"
                            placeholder={mockForm.splitMethod === 'share' ? '1' : '0.00'}
                            value={mockForm.memberValues?.[m.id] || ''}
                            onChange={(e) => {
                              const newValues = { ...mockForm.memberValues, [m.id]: e.target.value };
                              setMockForm({...mockForm, memberValues: newValues});
                            }}
                            style={{ padding: '0.5rem' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="submit" className="btn" style={{ background: 'transparent' }}>Save to Dashboard</button>
              <button 
                type="button" 
                className="btn btn-splitwise" 
                style={{ height: '48px', padding: '0 2.5rem' }}
                onClick={handleManualPush}
                disabled={!mockForm.selectedGroupId}
              >
                <FiArrowRight /> Push Directly
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="animate-up stagger-1">
        {transactions.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-secondary)' }}>
            <div style={{ 
              width: '80px', height: '80px', borderRadius: '50%', background: 'hsla(250, 89%, 65%, 0.1)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem'
            }}>
              <FiActivity size={32} style={{ color: 'var(--primary)', opacity: 0.5 }} />
            </div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>All Caught Up!</h3>
            <p className="subtitle">There are no unsynced transactions to process.</p>
          </div>
        ) : (
          <div className="transaction-list">
            {transactions.map((tx, idx) => {
              const isExpanded = expandedTxIds.includes(tx.id);
              const group = groups.find(g => g.id.toString() === (tx.selectedGroupId || "").toString());
              
              return (
                <div key={tx.id} className={`transaction-item glass-card animate-up stagger-${(idx % 3) + 1} ${isExpanded ? 'expanded' : ''}`} style={{ padding: 0, overflow: 'hidden' }}>
                  <div 
                    className="tx-header" 
                    onClick={() => toggleExpand(tx.id)}
                    style={{ 
                      padding: '1.25rem 1.5rem', 
                      cursor: 'pointer', 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      background: isExpanded ? 'hsla(0,0%,100%,0.03)' : 'transparent',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                      <div style={{ 
                        width: '42px', height: '42px', borderRadius: '12px', background: 'hsla(0,0%,100%,0.05)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem'
                      }}>
                        {tx.category?.toLowerCase() === 'food' ? '🍕' : tx.category?.toLowerCase() === 'transport' ? '🚗' : '📦'}
                      </div>
                      <div>
                        <div className="tx-name" style={{ fontSize: '1.1rem', fontWeight: '600' }}>{tx.name || tx.category || "General"}</div>
                        <div className="tx-date" style={{ fontSize: '0.8rem', opacity: 0.6 }}>{tx.date}</div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--primary)' }}>${tx.amount.toFixed(2)}</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {tx.plaid_transaction_id?.startsWith('mock') ? 'Mock' : 'Plaid'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button 
                          className="delete-btn" 
                          onClick={(e) => handleDelete(e, tx.id)}
                          title="Delete Transaction"
                          style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: 'var(--text-secondary)', 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: 0.4,
                            transition: 'var(--transition-smooth)'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseOut={(e) => e.currentTarget.style.opacity = '0.4'}
                        >
                          <FiTrash2 size={16} />
                        </button>
                        <FiChevronDown style={{ 
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', 
                          transition: 'var(--transition-smooth)',
                          opacity: 0.5,
                          fontSize: '1.2rem'
                        }} />
                      </div>
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="tx-content animate-fade-in" style={{ padding: '0 1.5rem 1.5rem' }}>
                      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem' }}>
                        <div className="tx-fields-grid">
                          <div>
                            <label className="field-label">Display Name</label>
                            <input 
                              type="text" 
                              className="glass-input" 
                              value={tx.name} 
                              onChange={(e) => handleTxChange(tx.id, 'name', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="field-label">Amount ($)</label>
                            <input 
                              type="number" 
                              className="glass-input" 
                              value={tx.amount} 
                              onChange={(e) => handleTxChange(tx.id, 'amount', parseFloat(e.target.value))}
                            />
                          </div>
                          <div>
                            <label className="field-label">Date</label>
                            <input 
                              type="date" 
                              className="glass-input" 
                              style={{ colorScheme: 'dark' }}
                              value={tx.displayDate || (tx.date ? (tx.date.includes('T') ? tx.date.split('T')[0] : tx.date) : new Date().toISOString().split('T')[0])} 
                              onChange={(e) => handleTxChange(tx.id, 'displayDate', e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="tx-fields-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'flex-end', marginTop: '1.5rem' }}>
                          <div>
                            <label className="field-label">Splitwise Group</label>
                            <select 
                              className="glass-select"
                              value={tx.selectedGroupId || ""}
                              onChange={(e) => handleGroupSelect(tx.id, e.target.value)}
                              style={{ borderColor: tx.confidence > 0.8 ? 'var(--primary)' : 'var(--border-light)' }}
                            >
                              <option value="" disabled>Select Group...</option>
                              <optgroup label="Outstanding Balance">
                                {groups.filter(g => g.isActive).map(g => (
                                  <option key={g.id} value={g.id} style={{ color: g.balance > 0 ? '#10b981' : '#ef4444' }}>
                                    {g.name} ({g.balance > 0 ? '+' : ''}{g.balance.toFixed(2)})
                                  </option>
                                ))}
                              </optgroup>
                              {!showActiveOnly && (
                                <optgroup label="Other Groups">
                                  {groups.filter(g => !g.isActive).map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>

                          <div>
                            <label className="field-label">Split Method</label>
                            <select 
                              className="glass-select"
                              value={tx.splitMethod || 'equally'}
                              onChange={(e) => handleTxChange(tx.id, 'splitMethod', e.target.value)}
                            >
                              <option value="equally">Equally</option>
                              <option value="share">By Share</option>
                              <option value="custom">Custom Amounts</option>
                            </select>
                          </div>

                          <div>
                            <label className="field-label">Who Paid?</label>
                            <select 
                              className="glass-select"
                              value={tx.payerId || currentUserId || ""}
                              onChange={(e) => handleTxChange(tx.id, 'payerId', e.target.value)}
                            >
                              {group?.members?.map(m => (
                                <option key={m.id} value={m.id}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</option>
                              ))}
                              {!tx.selectedGroupId && <option disabled>Select a group first</option>}
                            </select>
                          </div>
                        </div>

                        {/* Splitwise Member Selection Details */}
                        {tx.selectedGroupId && (
                          <div className="animate-fade-in" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-light)' }}>
                            <div className="field-label" style={{ marginBottom: '1rem', color: 'var(--primary)', fontWeight: '600' }}>
                              Who's Included in this split?
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                              {group?.members?.map(m => (
                                <label key={m.id} className="member-label" style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '0.6rem', 
                                  cursor: 'pointer', 
                                  background: (tx.includedMembers || []).includes(m.id) ? 'hsla(250, 89%, 65%, 0.1)' : 'hsla(0,0%,100%,0.03)', 
                                  padding: '0.6rem 1.1rem', 
                                  borderRadius: '12px', 
                                  border: (tx.includedMembers || []).includes(m.id) ? '1px solid var(--primary-glow)' : '1px solid var(--border-light)', 
                                  transition: 'var(--transition-smooth)' 
                                }}>
                                  <input 
                                    type="checkbox" 
                                    className="glass-checkbox"
                                    checked={(tx.includedMembers || []).some(id => id.toString() === m.id.toString())}
                                    onChange={(e) => {
                                      const current = tx.includedMembers || [];
                                      const next = e.target.checked 
                                        ? [...current, m.id] 
                                        : current.filter(id => id.toString() !== m.id.toString());
                                      handleTxChange(tx.id, 'includedMembers', next);
                                    }}
                                  />
                                  <span style={{ fontSize: '0.85rem', fontWeight: '500', color: (tx.includedMembers || []).some(id => id.toString() === m.id.toString()) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    {m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}
                                  </span>
                                </label>
                              ))}
                            </div>

                            {(tx.splitMethod === 'share' || tx.splitMethod === 'custom') && (
                              <div className="animate-up" style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'hsla(0,0%,0%,0.15)', borderRadius: '16px', border: '1px solid var(--border-light)' }}>
                                <div className="field-label" style={{ marginBottom: '1rem' }}>
                                  {tx.splitMethod === 'share' ? 'Specify Shares' : 'Exact Dollar Amounts'}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '1rem' }}>
                                  {group?.members?.filter(m => (tx.includedMembers || []).some(id => id.toString() === m.id.toString())).map(m => (
                                    <div key={m.id}>
                                      <label className="field-label" style={{ fontSize: '0.65rem' }}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</label>
                                      <input 
                                        type="number"
                                        className="glass-input"
                                        placeholder={tx.splitMethod === 'share' ? '1' : '0.00'}
                                        value={tx.memberValues?.[m.id] || ''}
                                        onChange={(e) => {
                                          const newValues = { ...tx.memberValues, [m.id]: e.target.value };
                                          handleTxChange(tx.id, 'memberValues', newValues);
                                        }}
                                        style={{ padding: '0.5rem' }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                           <button 
                            className="btn" 
                            style={{ background: 'transparent' }}
                            onClick={() => toggleExpand(tx.id)}
                          >
                            Close
                          </button>
                          <button 
                            className="btn btn-splitwise" 
                            style={{ height: '48px', padding: '0 2.5rem', fontSize: '1.05rem' }} 
                            onClick={() => handlePushToSplitwise(tx.id, tx)}
                            disabled={!tx.selectedGroupId}
                          >
                            <FiArrowRight /> Push to Splitwise
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default Dashboard;
