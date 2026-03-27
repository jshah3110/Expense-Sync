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
  const [selectedTxIds, setSelectedTxIds] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [merchantFilter, setMerchantFilter] = useState('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [showFilters, setShowFilters] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (datePreset === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (datePreset === '7days') {
      const d = new Date(); d.setDate(d.getDate() - 7);
      setDateFrom(d.toISOString().split('T')[0]);
      setDateTo(new Date().toISOString().split('T')[0]);
    } else if (datePreset === '30days') {
      const d = new Date(); d.setDate(d.getDate() - 30);
      setDateFrom(d.toISOString().split('T')[0]);
      setDateTo(new Date().toISOString().split('T')[0]);
    } else if (datePreset === 'thisMonth') {
      const today = new Date();
      setDateFrom(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]);
      setDateTo(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]);
    } else if (datePreset === 'lastMonth') {
      const today = new Date();
      setDateFrom(new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0]);
      setDateTo(new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split('T')[0]);
    }
  }, [datePreset]);

  const toggleExpand = (id) => {
    setExpandedTxIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  const [currentUserId, setCurrentUserId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showMockForm, setShowMockForm] = useState(false);
  const [activeTab, setActiveTab] = useState('backlog'); // 'backlog' | 'pushed'
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

  useEffect(() => {
    setCurrentPage(1);
  }, [datePreset, dateFrom, dateTo, sortConfig, categoryFilter, bankFilter, merchantFilter]);

  const [syncDays, setSyncDays] = useState('30');

  const handleSyncBank = async () => {
    setIsSyncing(true);
    try {
      await axios.get(`${API_BASE}/api/transactions/sync?days=${syncDays}`);
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
        cost: tx.amount.toFixed(2),
        description: tx.name,
        group_id: tx.selectedGroupId,
        date: tx.displayDate || tx.date
      };

      const splitMethod = tx.splitMethod || 'equally';
      const payerId = tx.payerId || currentUserId;
      const includedIds = tx.includedMembers || group.members?.map(m => m.id) || [];
      const includedMembers = group.members?.filter(m => includedIds.includes(m.id)) || [];

      if (includedMembers.length === 0) throw new Error("At least one member must be selected for the split");

      // PRE-CALCULATE OWED SHARES TO FIX PENNY DRIFT
      const owedSharesMap = {};
      let totalAssigned = 0;
      
      if (splitMethod === 'equally') {
        const baseShare = Number((tx.amount / includedMembers.length).toFixed(2));
        includedMembers.forEach(m => {
          owedSharesMap[m.id] = baseShare;
          totalAssigned += baseShare;
        });
      } else if (splitMethod === 'share') {
        const totalShares = includedMembers.reduce((acc, m) => acc + (parseFloat(tx.memberValues?.[m.id]) || 0), 0);
        if (totalShares === 0) throw new Error("Total shares cannot be zero");
        
        includedMembers.forEach(m => {
          const myShareCount = parseFloat(tx.memberValues?.[m.id]) || 0;
          const baseShare = Number(((tx.amount * myShareCount) / totalShares).toFixed(2));
          owedSharesMap[m.id] = baseShare;
          totalAssigned += baseShare;
        });
      } else if (splitMethod === 'custom') {
        includedMembers.forEach(m => {
          const baseShare = Number(parseFloat(tx.memberValues?.[m.id]) || 0);
          owedSharesMap[m.id] = baseShare;
          totalAssigned += baseShare;
        });
      }
      
      const targetTotal = Number(tx.amount.toFixed(2));
      const difference = Math.round((targetTotal - totalAssigned) * 100);
      
      // Assign any missing/extra pennies to the first active member securely
      if (includedMembers.length > 0 && difference !== 0) {
        owedSharesMap[includedMembers[0].id] = Number((owedSharesMap[includedMembers[0].id] + (difference / 100)).toFixed(2));
      }

      payload.split_equally = false;
      payload.users = group.members.map(m => ({
        user_id: m.id,
        paid_share: m.id.toString() === payerId.toString() ? tx.amount.toFixed(2) : "0.00",
        owed_share: includedIds.includes(m.id) ? (owedSharesMap[m.id] || 0).toFixed(2) : "0.00"
      }));

      const finalTotalOwed = payload.users.reduce((acc, u) => acc + parseFloat(u.owed_share), 0);
      if (splitMethod === 'custom' && Math.abs(finalTotalOwed - tx.amount) > 0.05) {
        if (!confirm(`Total custom split ($${finalTotalOwed.toFixed(2)}) doesn't match total amount ($${tx.amount.toFixed(2)}). Push anyway (Splitwise may reject this)?`)) return;
      }
      
      const result = await axios.post(`${API_BASE}/api/splitwise/expense`, payload);
      
      // Mark as synced in the DB
      const splitwiseId = result.data?.expenses?.[0]?.id?.toString() || null;
      await axios.patch(`${API_BASE}/api/transactions/${id}/mark_synced`, {
        splitwise_expense_id: splitwiseId,
        group_id: tx.selectedGroupId
      });
      
      // Update local state — mark synced instead of removing
      setTransactions(prev => prev.map(t => 
        t.id === id ? { ...t, is_synced: true, splitwise_expense_id: splitwiseId } : t
      ));
      setExpandedTxIds(prev => prev.filter(i => i !== id));
      setActiveTab('pushed');
      
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

  const handleIgnore = async (e, id) => {
    e.stopPropagation();
    try {
      await axios.patch(`${API_BASE}/api/transactions/${id}/ignore`);
      setTransactions(prev => prev.map(t => 
        t.id === id ? { ...t, is_ignored: true, is_synced: false } : t
      ));
      setExpandedTxIds(prev => prev.filter(i => i !== id));
    } catch (error) {
      alert("Failed to ignore transaction.");
    }
  };

  const handleUnignore = async (e, id) => {
    e.stopPropagation();
    try {
      await axios.patch(`${API_BASE}/api/transactions/${id}/unignore`);
      setTransactions(prev => prev.map(t => 
        t.id === id ? { ...t, is_ignored: false, is_synced: false } : t
      ));
      setExpandedTxIds(prev => prev.filter(i => i !== id));
      setActiveTab('backlog');
    } catch (error) {
      alert("Failed to restore transaction.");
    }
  };

  const displayedTransactions = transactions.filter(t => {
    let isRightTab = false;
    if (activeTab === 'backlog') isRightTab = !t.is_synced && !t.is_ignored;
    else if (activeTab === 'pushed') isRightTab = t.is_synced && !t.is_ignored;
    else if (activeTab === 'others') isRightTab = !!t.is_ignored;
    
    if (!isRightTab) return false;
    
    const txDate = t.displayDate || (t.date ? (t.date.includes('T') ? t.date.split('T')[0] : t.date) : '');
    if (dateFrom && txDate < dateFrom) return false;
    if (dateTo && txDate > dateTo) return false;

    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (bankFilter !== 'all' && (t.bank_name || 'Unknown') !== bankFilter) return false;
    if (merchantFilter && !(t.name || t.category || "General").toLowerCase().includes(merchantFilter.toLowerCase())) return false;
    
    return true;
  }).sort((a, b) => {
    if (sortConfig.key === 'amount') {
      return sortConfig.direction === 'asc' ? a.amount - b.amount : b.amount - a.amount;
    }
    if (sortConfig.key === 'date') {
      const dateA = a.displayDate || a.date;
      const dateB = b.displayDate || b.date;
      if (dateA < dateB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (dateA > dateB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    }
    return 0;
  });

  const totalPages = Math.ceil(displayedTransactions.length / itemsPerPage);
  const paginatedTransactions = displayedTransactions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '4rem' }}><FiRefreshCw className="spin" size={32} /></div>;
  }

  // React element securely rendering the Sync Bank actions securely.
  const syncButtonContent = (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <button className="btn" style={{ padding: '0.6rem 1.25rem', border: 'none', background: isMobile ? 'var(--primary)' : 'transparent', color: '#fff', boxShadow: 'none', borderRadius: isMobile ? '12px 0 0 12px' : 0, margin: 0 }} onClick={handleSyncBank} disabled={isSyncing}>
        <FiRefreshCw className={isSyncing ? 'spin' : ''} /> 
        {isSyncing ? 'Syncing...' : 'Sync Now'}
      </button>
      <div style={{ width: '1px', background: 'hsla(0,0%,100%,0.2)', margin: '0.4rem 0' }}></div>
      <div style={{ position: 'relative' }}>
        <select 
          className="glass-select" 
          value={syncDays}
          onChange={(e) => setSyncDays(e.target.value)}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            boxShadow: 'none', 
            padding: '0.6rem 2rem 0.6rem 1rem', 
            width: '100%', 
            height: '100%',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            appearance: 'none',
            outline: 'none',
            borderRadius: isMobile ? '0 12px 12px 0' : 0
          }}
        >
          <option value="7" style={{color: '#000'}}>Past 7 Days</option>
          <option value="30" style={{color: '#000'}}>Past 30 Days</option>
          <option value="90" style={{color: '#000'}}>Past 90 Days</option>
          <option value="all" style={{color: '#000'}}>Unlimited History</option>
        </select>
        <div style={{ position: 'absolute', right: '0.8rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }}>
          <FiChevronDown size={14} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* ─── FILTER BAR ─────────────────────────────────────────── */}
      <div style={{ 
        padding: isMobile 
          ? `calc(env(safe-area-inset-top, 0px) + 0.85rem) 1.25rem 0` 
          : '0 0 0.5rem',
        background: isMobile ? 'hsla(240,10%,5%,0.98)' : 'transparent',
        borderBottom: isMobile ? '1px solid var(--border-light)' : 'none',
        marginBottom: isMobile ? '0' : '1rem',
      }}>

        {/* Row 1: Title + Add button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', marginBottom: '0.05rem', lineHeight: 1.1 }}>Transactions</h2>
            <p className="subtitle" style={{ fontSize: '0.72rem', opacity: 0.4, margin: 0 }}>Tap to review &amp; push to Splitwise</p>
          </div>
          <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.76rem', gap: '0.3rem', minHeight: '34px', flexShrink: 0 }} onClick={() => setShowMockForm(!showMockForm)}>
            {showMockForm ? <FiX size={13} /> : <FiPlus size={13} />} {showMockForm ? 'Cancel' : 'Add'}
          </button>
        </div>

        {/* Row 2: Sync Now button (mobile only, full width) */}
        {isMobile && isConnected && (
          <div style={{ marginBottom: '0.85rem', display: 'flex', gap: '0.5rem' }}>
            <div style={{ flex: 1, display: 'flex', background: 'hsla(0,0%,100%,0.04)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
              {syncButtonContent}
            </div>
          </div>
        )}

        {/* Row 3: Date filter chips — horizontally scrollable */}
        <div 
          className="chip-row" 
          style={{ 
            display: 'flex', gap: '0.4rem', 
            overflowX: 'auto', 
            paddingBottom: '0.75rem', 
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
            touchAction: 'pan-x',
          }}
        >
          {[
            { label: 'All time', value: 'all' },
            { label: '7 days', value: '7days' },
            { label: '30 days', value: '30days' },
            { label: 'This month', value: 'thisMonth' },
            { label: 'Last month', value: 'lastMonth' },
            { label: 'Custom…', value: 'custom' },
          ].map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDatePreset(value)}
              style={{
                flexShrink: 0,
                padding: '0.3rem 0.75rem',
                borderRadius: '999px',
                border: '1px solid',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.18s',
                background: datePreset === value ? 'var(--primary)' : 'hsla(0,0%,100%,0.06)',
                borderColor: datePreset === value ? 'transparent' : 'var(--border-light)',
                color: 'var(--text-primary)',
                letterSpacing: '0.01em',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {datePreset === 'custom' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            <input type="date" className="glass-input" style={{ padding: '0.4rem 0.7rem', colorScheme: 'dark', fontSize: '0.82rem', minHeight: 'unset', flex: 1 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span style={{ opacity: 0.35, fontSize: '0.9rem' }}>→</span>
            <input type="date" className="glass-input" style={{ padding: '0.4rem 0.7rem', colorScheme: 'dark', fontSize: '0.82rem', minHeight: 'unset', flex: 1 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        )}

        {/* Search + compact filters: 2-col grid on mobile to prevent truncation */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'auto auto auto auto', gap: '0.5rem', marginBottom: '0.9rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', gridColumn: isMobile ? 'span 2' : 'auto' }}>
            <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.35, fontSize: '0.8rem', pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              className="glass-input"
              placeholder="Search merchants..."
              value={merchantFilter}
              onChange={(e) => setMerchantFilter(e.target.value)}
              style={{ paddingLeft: '2.1rem', paddingTop: '0.45rem', paddingBottom: '0.45rem', minHeight: 'unset', fontSize: '0.84rem', width: '100%' }}
            />
          </div>
          <select className="glass-select" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}
            style={{ padding: '0.45rem 1.5rem 0.45rem 0.7rem', fontSize: '0.78rem', minHeight: 'unset', width: '100%' }}>
            <option value="all">All banks</option>
            {Array.from(new Set(transactions.map(t => t.bank_name || 'Unknown').filter(b => b !== 'Unknown'))).map(bank => (
              <option key={bank} value={bank}>{bank}</option>
            ))}
          </select>
          <select className="glass-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ padding: '0.45rem 1.5rem 0.45rem 0.7rem', fontSize: '0.78rem', minHeight: 'unset', width: '100%' }}>
            <option value="all">All categories</option>
            {Array.from(new Set(transactions.map(t => t.category).filter(Boolean))).sort().map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select className="glass-select" value={`${sortConfig.key}-${sortConfig.direction}`}
            onChange={(e) => { const [key, direction] = e.target.value.split('-'); setSortConfig({ key, direction }); }}
            style={{ padding: '0.45rem 1.5rem 0.45rem 0.7rem', fontSize: '0.78rem', minHeight: 'unset', width: '100%', gridColumn: isMobile ? 'span 1' : 'auto' }}>
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
            <option value="amount-desc">$ High↓</option>
            <option value="amount-asc">$ Low↑</option>
          </select>
        </div>
      </div>
      {/* ─── END FILTER BAR ──────────────────────────────────────── */}

      {showMockForm && (
        <div className="glass-card animate-up" style={{ marginBottom: '2rem', padding: '1.25rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Manual Transaction</h3>
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

      <div className="animate-up stagger-1" style={{ padding: isMobile ? '0 1.25rem' : '0' }}>
        {/* Tab switcher — compact underline style on mobile */}
        <div style={{ 
          display: 'flex', gap: '0', marginBottom: '0', marginTop: '0.75rem',
          borderBottom: '1px solid var(--border-light)'
        }}>
          {['backlog', 'others', 'pushed'].map(tab => {
            const count = transactions.filter(t => {
              if (tab === 'backlog') return !t.is_synced && !t.is_ignored;
              if (tab === 'pushed') return t.is_synced && !t.is_ignored;
              if (tab === 'others') return t.is_ignored;
              return false;
            }).length;
            
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setCurrentPage(1); }}
                style={{
                  flex: 1,
                  padding: '0.7rem 0.5rem',
                  borderRadius: 0,
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.82rem',
                  border: 'none',
                  borderBottom: isActive ? `2px solid ${
                    tab === 'pushed' ? 'hsl(150, 60%, 50%)' : 
                    tab === 'others' ? 'hsla(0,0%,100%,0.5)' : 
                    'var(--primary)'
                  }` : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                  background: 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  marginBottom: '-1px',
                }}
              >
                {tab === 'backlog' ? 'Backlog' : tab === 'pushed' ? 'Pushed' : 'Others'}
                <span style={{ 
                  marginLeft: '0.35rem', 
                  fontSize: '0.72rem',
                  opacity: isActive ? 0.8 : 0.5,
                  background: isActive ? 'hsla(0,0%,100%,0.1)' : 'transparent',
                  padding: '1px 5px', borderRadius: '99px'
                }}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Select all + bulk delete — hidden on mobile to reduce clutter */}
        {displayedTransactions.length > 0 && !isMobile && (
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', padding: '0.5rem 0' }}>
             <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 className="glass-checkbox"
                 checked={selectedTxIds.length === displayedTransactions.length && displayedTransactions.length > 0}
                 onChange={(e) => setSelectedTxIds(e.target.checked ? displayedTransactions.map(t => t.id) : [])}
               />
               <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Select All</span>
             </label>
             
             {selectedTxIds.length > 0 && (
               <button 
                 onClick={async () => {
                   if (!confirm(`Are you sure you want to completely delete ${selectedTxIds.length} synced transactions?`)) return;
                   try {
                     await axios.post(`${API_BASE}/api/transactions/bulk_delete`, { tx_ids: selectedTxIds });
                     setTransactions(prev => prev.filter(t => !selectedTxIds.includes(t.id)));
                     setSelectedTxIds([]);
                   } catch(e) { alert("Failed to bulk delete"); }
                 }}
                 style={{ 
                   background: 'hsla(0, 80%, 50%, 0.1)', color: '#ef4444', border: '1px solid #ef4444',
                   padding: '0.4rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                   display: 'flex', alignItems: 'center'
                 }}
               >
                 <FiTrash2 style={{ marginRight: '0.4rem' }} />
                 Delete Selected ({selectedTxIds.length})
               </button>
             )}
           </div>
        )}

        {displayedTransactions.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-secondary)' }}>
            <div style={{ 
              width: '80px', height: '80px', borderRadius: '50%', background: 'hsla(250, 89%, 65%, 0.1)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem'
            }}>
              <FiActivity size={32} style={{ color: 'var(--primary)', opacity: 0.5 }} />
            </div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Transactions</h3>
            <p className="subtitle">Adjust your date filters or sync your bank to see more.</p>
          </div>
        ) : (
          <>
            <div className="transaction-list">
              {paginatedTransactions.map((tx, idx) => {
              const isExpanded = expandedTxIds.includes(tx.id);
              const group = groups.find(g => g.id.toString() === (tx.selectedGroupId || "").toString());
              
              return (
                <div key={tx.id} className={`transaction-item glass-card animate-up stagger-${(idx % 3) + 1} ${isExpanded ? 'expanded' : ''}`} style={{ padding: 0, overflow: 'hidden', marginBottom: '0.75rem' }}>
                    <div 
                    className="tx-header" 
                    onClick={() => toggleExpand(tx.id)}
                    style={{ 
                      padding: '0.75rem 1rem', 
                      cursor: 'pointer', 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      background: isExpanded ? 'hsla(0,0%,100%,0.03)' : 'transparent',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                  {/* Left side: checkbox + logo + name/meta */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0, flex: 1 }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                      <input 
                        type="checkbox" 
                        className="glass-checkbox"
                        checked={selectedTxIds.includes(tx.id)}
                        onChange={(e) => setSelectedTxIds(prev => e.target.checked ? [...prev, tx.id] : prev.filter(id => id !== tx.id))}
                      />
                    </div>
                    <div style={{ 
                      width: '40px', height: '40px', minWidth: '40px', borderRadius: '10px',
                      background: 'hsla(250, 89%, 65%, 0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.15rem', overflow: 'hidden', flexShrink: 0
                    }}>
                      {tx.logo_url ? (
                        <img src={tx.logo_url} alt={tx.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        tx.category?.toLowerCase() === 'food' ? '🍔' :
                        tx.category?.toLowerCase() === 'transport' ? '🚙' :
                        tx.category?.toLowerCase() === 'entertainment' ? '🎬' : '🛒'
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="tx-name" style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.2 }}>
                        {tx.name || tx.category || 'General'}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {tx.displayDate || (tx.date ? tx.date.split('T')[0] : '')}
                        </span>
                        {tx.bank_name && (
                          <span style={{ 
                            background: 'hsla(0,0%,100%,0.08)', 
                            padding: '1px 5px', borderRadius: '4px',
                            fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.02em'
                          }}>🏦 {tx.bank_name}</span>
                        )}
                        {tx.is_ignored && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.7 }}>👻 others</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side: amount + status + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '1rem', fontWeight: 700, 
                        color: tx.is_synced ? 'hsl(150, 60%, 50%)' : tx.is_ignored ? 'var(--text-muted)' : 'var(--text-primary)'
                      }}>
                        ${tx.amount.toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.04em', marginTop: '0.1rem' }}>
                        {tx.is_synced ? (
                          <span style={{ color: 'hsl(150, 60%, 50%)' }}>✓ Synced</span>
                        ) : tx.category ? (
                          <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{tx.category}</span>
                        ) : null}
                      </div>
                    </div>
                    <button 
                      className="delete-btn" 
                      onClick={(e) => handleDelete(e, tx.id)}
                      title="Delete"
                      style={{ 
                        background: 'transparent', border: 'none', color: 'var(--text-muted)', 
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        opacity: 0.3, transition: 'opacity 0.2s', padding: '0.25rem', flexShrink: 0
                      }}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '0.3'}
                    >
                      <FiTrash2 size={15} />
                    </button>
                    <FiChevronDown style={{ 
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', 
                      transition: 'transform 0.25s ease',
                      opacity: 0.4, fontSize: '1rem', flexShrink: 0
                    }} />
                  </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="tx-content animate-fade-in" style={{ padding: '0 1.25rem 1.5rem' }}>
                      <div style={{ borderTop: '1px solid hsla(0,0%,100%,0.06)', paddingTop: '1rem' }}>

                        {/* ── Edit fields: Name + Amount, then Date ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
                          <div>
                            <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Name</label>
                            <input
                              type="text"
                              className="glass-input"
                              style={{ minHeight: 'unset', padding: '0.5rem 0.7rem', fontSize: '0.85rem' }}
                              value={tx.name}
                              onChange={(e) => handleTxChange(tx.id, 'name', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Amount</label>
                            <input
                              type="number"
                              className="glass-input"
                              style={{ minHeight: 'unset', padding: '0.5rem 0.7rem', fontSize: '0.85rem' }}
                              value={tx.amount}
                              onChange={(e) => handleTxChange(tx.id, 'amount', parseFloat(e.target.value))}
                            />
                          </div>
                        </div>
                        <div style={{ marginBottom: '1.25rem' }}>
                          <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Date</label>
                          <input
                            type="date"
                            className="glass-input"
                            style={{ colorScheme: 'dark', minHeight: 'unset', padding: '0.5rem 0.7rem', fontSize: '0.85rem', width: '100%' }}
                            value={tx.displayDate || (tx.date ? (tx.date.includes('T') ? tx.date.split('T')[0] : tx.date) : new Date().toISOString().split('T')[0])}
                            onChange={(e) => handleTxChange(tx.id, 'displayDate', e.target.value)}
                          />
                        </div>

                        {/* ── Splitwise section ── */}
                        {!tx.is_synced && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem' }}>
                              <div style={{ flex: 1, height: '1px', background: 'hsla(0,0%,100%,0.07)' }} />
                              <span style={{ fontSize: '0.65rem', fontWeight: 700, opacity: 0.35, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Splitwise</span>
                              <div style={{ flex: 1, height: '1px', background: 'hsla(0,0%,100%,0.07)' }} />
                            </div>

                            {/* Not for Splitwise — full width, subtle */}
                            {activeTab !== 'others' && (
                              <button
                                onClick={(e) => handleIgnore(e, tx.id)}
                                style={{
                                  width: '100%', marginBottom: '0.75rem',
                                  padding: '0.55rem', borderRadius: '10px',
                                  background: 'hsla(0,0%,100%,0.04)',
                                  border: '1px solid hsla(0,0%,100%,0.1)',
                                  color: 'var(--text-muted)', fontSize: '0.83rem',
                                  fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em',
                                }}
                              >
                                🚫 Not for Splitwise
                              </button>
                            )}

                            {/* Group + Method */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
                              <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Group</label>
                                <select
                                  className="glass-select"
                                  style={{ minHeight: 'unset', padding: '0.5rem 1.6rem 0.5rem 0.7rem', fontSize: '0.82rem', width: '100%', borderColor: tx.confidence > 0.8 ? 'var(--primary)' : 'var(--border-light)' }}
                                  value={tx.selectedGroupId || ''}
                                  onChange={(e) => handleGroupSelect(tx.id, e.target.value)}
                                >
                                  <option value="" disabled>Pick group…</option>
                                  <optgroup label="Active">
                                    {groups.filter(g => g.isActive).map(g => (
                                      <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                  </optgroup>
                                  {!showActiveOnly && (
                                    <optgroup label="Others">
                                      {groups.filter(g => !g.isActive).map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Split</label>
                                <select
                                  className="glass-select"
                                  style={{ minHeight: 'unset', padding: '0.5rem 1.6rem 0.5rem 0.7rem', fontSize: '0.82rem', width: '100%' }}
                                  value={tx.splitMethod || 'equally'}
                                  onChange={(e) => handleTxChange(tx.id, 'splitMethod', e.target.value)}
                                >
                                  <option value="equally">Equally</option>
                                  <option value="share">By Share</option>
                                  <option value="custom">Custom $</option>
                                </select>
                              </div>
                            </div>

                            {/* Payer — full width */}
                            <div style={{ marginBottom: tx.selectedGroupId ? '0.75rem' : '0' }}>
                              <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Who paid?</label>
                              <select
                                className="glass-select"
                                style={{ minHeight: 'unset', padding: '0.5rem 1.6rem 0.5rem 0.7rem', fontSize: '0.82rem', width: '100%' }}
                                value={tx.payerId || currentUserId || ''}
                                onChange={(e) => handleTxChange(tx.id, 'payerId', e.target.value)}
                              >
                                {group?.members?.map(m => (
                                  <option key={m.id} value={m.id}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</option>
                                ))}
                                {!tx.selectedGroupId && <option disabled>Select a group first</option>}
                              </select>
                            </div>

                            {/* Members to include */}
                            {tx.selectedGroupId && (
                              <div className="animate-fade-in" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.45, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Split with</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  {group?.members?.map(m => {
                                    const included = (tx.includedMembers || []).some(id => id.toString() === m.id.toString());
                                    return (
                                      <label key={m.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                                        cursor: 'pointer', padding: '0.4rem 0.85rem', borderRadius: '999px',
                                        background: included ? 'hsla(250, 89%, 65%, 0.15)' : 'hsla(0,0%,100%,0.05)',
                                        border: included ? '1px solid var(--primary-glow)' : '1px solid var(--border-light)',
                                        fontSize: '0.82rem', fontWeight: 500,
                                        color: included ? 'var(--text-primary)' : 'var(--text-muted)',
                                        transition: 'all 0.18s',
                                      }}>
                                        <input
                                          type="checkbox"
                                          className="glass-checkbox"
                                          checked={included}
                                          onChange={(e) => {
                                            const current = tx.includedMembers || [];
                                            const next = e.target.checked
                                              ? [...current, m.id]
                                              : current.filter(id => id.toString() !== m.id.toString());
                                            handleTxChange(tx.id, 'includedMembers', next);
                                          }}
                                          style={{ display: 'none' }}
                                        />
                                        {m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}
                                      </label>
                                    );
                                  })}
                                </div>

                                {(tx.splitMethod === 'share' || tx.splitMethod === 'custom') && (
                                  <div style={{ marginTop: '0.75rem', padding: '0.85rem', background: 'hsla(0,0%,0%,0.15)', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, opacity: 0.5, marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                      {tx.splitMethod === 'share' ? 'Shares' : 'Amounts ($)'}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.6rem' }}>
                                      {group?.members?.filter(m => (tx.includedMembers || []).some(id => id.toString() === m.id.toString())).map(m => (
                                        <div key={m.id}>
                                          <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '0.2rem' }}>{m.id.toString() === currentUserId?.toString() ? 'You' : m.first_name}</div>
                                          <input
                                            type="number"
                                            className="glass-input"
                                            placeholder={tx.splitMethod === 'share' ? '1' : '0.00'}
                                            value={tx.memberValues?.[m.id] || ''}
                                            onChange={(e) => handleTxChange(tx.id, 'memberValues', { ...tx.memberValues, [m.id]: e.target.value })}
                                            style={{ padding: '0.4rem 0.5rem', minHeight: 'unset', fontSize: '0.82rem' }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}

                        {/* ── Action buttons ── */}
                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                          <button
                            onClick={() => toggleExpand(tx.id)}
                            style={{
                              flex: isMobile ? 'none' : 1,
                              padding: '0.7rem',
                              borderRadius: '12px',
                              background: 'hsla(0,0%,100%,0.05)',
                              border: '1px solid hsla(0,0%,100%,0.1)',
                              color: 'var(--text-muted)', fontSize: '0.9rem',
                              fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Close
                          </button>

                          {activeTab === 'others' ? (
                            <button
                              onClick={(e) => handleUnignore(e, tx.id)}
                              style={{
                                flex: isMobile ? 'none' : 2,
                                padding: '0.7rem',
                                borderRadius: '12px',
                                background: 'hsla(250,89%,65%,0.15)',
                                border: '1px solid var(--primary-glow)',
                                color: 'var(--text-primary)', fontSize: '0.9rem',
                                fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              ↩ Move to Backlog
                            </button>
                          ) : !tx.is_synced ? (
                            <button
                              className="btn-splitwise"
                              onClick={(e) => { e.stopPropagation(); handlePush(tx); }}
                              disabled={!tx.selectedGroupId}
                              style={{
                                flex: isMobile ? 'none' : 2,
                                padding: '0.7rem',
                                borderRadius: '12px',
                                fontSize: '0.95rem', fontWeight: 700,
                                cursor: tx.selectedGroupId ? 'pointer' : 'not-allowed',
                                opacity: tx.selectedGroupId ? 1 : 0.4,
                              }}
                            >
                              → Push to Splitwise
                            </button>
                          ) : (
                            <button
                              onClick={(e) => handleUnsynced(e, tx.id)}
                              style={{
                                flex: isMobile ? 'none' : 2,
                                padding: '0.7rem',
                                borderRadius: '12px',
                                background: 'hsla(0,80%,50%,0.1)',
                                border: '1px solid hsla(0,80%,50%,0.3)',
                                color: '#ef4444', fontSize: '0.9rem',
                                fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              ↩ Unsynced
                            </button>
                          )}
                        </div>

                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem', marginBottom: '1rem' }}>
                <button 
                  className="btn" 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.85rem', opacity: 0.7, fontWeight: 500 }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button 
                  className="btn" 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default Dashboard;
