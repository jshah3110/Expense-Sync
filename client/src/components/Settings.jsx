import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiLink2, FiAlertCircle } from 'react-icons/fi';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { usePlaidLink } from 'react-plaid-link';
import API_BASE from '../config';

const Settings = () => {
  const [splitwiseConnected, setSplitwiseConnected] = useState(false);
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [linkToken, setLinkToken] = useState(null);
  const location = useLocation();

  const fetchStatus = async () => {
    try {
      const swRes = await axios.get(`${API_BASE}/api/splitwise/status`);
      setSplitwiseConnected(swRes.data.connected);
      
      const plRes = await axios.get(`${API_BASE}/api/transactions/status`);
      setPlaidConnected(plRes.data.connected);
    } catch (e) {
      console.error("Status check failed", e);
    }
  };

  const generateLinkToken = async () => {
    try {
      const res = await axios.post(`${API_BASE}/api/transactions/create_link_token`);
      setLinkToken(res.data.link_token);
    } catch (e) {
      console.error("Failed to generate link token", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    generateLinkToken();

    const queryParams = new URLSearchParams(location.search);
    if (queryParams.get('splitwise') === 'success') {
      setSplitwiseConnected(true);
    }
  }, [location]);

  const handleConnectSplitwise = () => {
    window.location.href = `${API_BASE}/api/splitwise/connect`;
  };

  const onSuccess = async (public_token, metadata) => {
    try {
      await axios.post(`${API_BASE}/api/transactions/set_access_token`, {
        public_token: public_token
      });
      setPlaidConnected(true);
    } catch (e) {
      console.error("Failed to set access token", e);
      alert("Failed to connect bank.");
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <div className="animate-fade-in stagger-1">
      <h2>Integrations</h2>
      <p className="subtitle">Connect your accounts to automate expense tracking.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Splitwise Card */}
        <div className="glass-card animate-fade-in stagger-2">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--splitwise)' }}>Splitwise</span> Connection
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Required to sync categorised expenses to your groups.
              </p>
            </div>
            {splitwiseConnected ? (
              <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: '500' }}>
                <FiCheckCircle /> Connected
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FiAlertCircle /> Disconnected
              </span>
            )}
          </div>

          {!splitwiseConnected && (
            <button className="btn btn-splitwise" onClick={handleConnectSplitwise}>
              <FiLink2 /> Connect Splitwise Account
            </button>
          )}
        </div>

        {/* Plaid Card */}
        <div className="glass-card animate-fade-in stagger-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: '#111111', background: '#fff', padding: '0 4px', borderRadius: '4px' }}>Plaid</span> Bank Sync
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Securely connect your bank to pull in recent transactions.
              </p>
            </div>
            {plaidConnected ? (
              <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: '500' }}>
                <FiCheckCircle /> Connected
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FiAlertCircle /> Disconnected
              </span>
            )}
          </div>

          {!plaidConnected && (
            <button 
              className="btn" 
              onClick={() => open()} 
              disabled={!ready}
              style={{ background: '#fff', color: '#111', borderColor: '#fff', opacity: ready ? 1 : 0.5 }}
            >
              <FiLink2 /> Connect Bank via Plaid
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
