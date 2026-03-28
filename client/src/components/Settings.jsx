import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiLink2, FiAlertCircle, FiSun, FiMoon, FiTrash2 } from 'react-icons/fi';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { usePlaidLink } from 'react-plaid-link';
import API_BASE from '../config';

const Settings = ({ theme = 'dark', onToggleTheme }) => {
  const [splitwiseConnected, setSplitwiseConnected] = useState(false);
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidConnections, setPlaidConnections] = useState([]);
  const [linkToken, setLinkToken] = useState(null);
  const location = useLocation();

  const fetchStatus = async () => {
    try {
      const swRes = await axios.get(`${API_BASE}/api/splitwise/status`);
      setSplitwiseConnected(swRes.data.connected);
      
      const plRes = await axios.get(`${API_BASE}/api/transactions/status`);
      setPlaidConnected(plRes.data.connected);
      setPlaidConnections(plRes.data.connections || []);
    } catch (e) {
      console.error("Status check failed", e);
    }
  };

  const generateLinkToken = async () => {
    try {
      // In OAuth flow, Plaid redirects back to this page with oauth_state_id.
      // We must not generate a new link token if we are returning from an OAuth redirect.
      const queryParams = new URLSearchParams(window.location.search);
      if (queryParams.get('oauth_state_id')) {
        const savedToken = localStorage.getItem('plaid_link_token');
        if (savedToken) {
          setLinkToken(savedToken);
        }
        return;
      }

      // Only pass redirect_uri for non-localhost production URLs.
      // Plaid Production requires redirect URIs to be pre-registered; localhost is not.
      const currentUrl = window.location.href.split('?')[0];
      const isLocalhost = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
      const body = isLocalhost ? {} : { redirect_uri: currentUrl };

      const res = await axios.post(`${API_BASE}/api/transactions/create_link_token`, body);
      setLinkToken(res.data.link_token);
      localStorage.setItem('plaid_link_token', res.data.link_token);
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

  const handleDeleteConnection = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/transactions/connections/${id}`);
      await fetchStatus();
    } catch (e) {
      console.error("Failed to delete connection", e);
      alert("Failed to remove bank connection.");
    }
  };

  const onSuccess = async (public_token, metadata) => {
    try {
      await axios.post(`${API_BASE}/api/transactions/set_access_token`, {
        public_token: public_token
      });
      await fetchStatus();
    } catch (e) {
      console.error("Failed to set access token", e);
      alert("Failed to connect bank.");
    }
  };

  const onExit = (error, metadata) => {
    if (error) {
      console.error("Plaid Exit Error:", error, metadata);
      alert(`Plaid closed with error: ${error.error_message || error.error_code}`);
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready && window.location.href.includes('?oauth_state_id=')) {
      open();
    }
  }, [ready, open]);

  return (
    <div className="animate-fade-in stagger-1">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Settings</h2>
      <p className="subtitle" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>Manage your preferences and integrations.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Appearance Card */}
        <div className="glass-card animate-fade-in stagger-1" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', fontWeight: 600 }}>Appearance</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <FiSun size={16} />
              <span>Light</span>
            </div>
            <button
              onClick={onToggleTheme}
              className={`theme-toggle ${theme === 'dark' ? 'dark' : ''}`}
              aria-label="Toggle theme"
            >
              <div className="theme-toggle-knob" />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <span>Dark</span>
              <FiMoon size={16} />
            </div>
          </div>
        </div>
        {/* Integrations heading */}
        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', paddingLeft: '0.25rem', marginTop: '0.5rem' }}>Integrations</h3>

        {/* Splitwise Card */}
        <div className="glass-card animate-fade-in stagger-2" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '1.1rem' }}>
                <span style={{ color: 'var(--splitwise)' }}>Splitwise</span>
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                Required for group syncing.
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
        <div className="glass-card animate-fade-in stagger-3" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '1.1rem' }}>
                <span style={{ color: '#111111', background: '#fff', padding: '0 4px', borderRadius: '4px' }}>Plaid</span> Bank Sync
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                Securely pull recent transactions.
              </p>
            </div>
            {plaidConnected ? (
              <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: '500' }}>
                <FiCheckCircle /> Live
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FiAlertCircle /> Disconnected
              </span>
            )}
          </div>

          {plaidConnections.length > 0 && (
            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {plaidConnections.map(c => (
                <div key={c.id} style={{
                  background: 'var(--surface-overlay)', border: '1px solid var(--border-light)',
                  padding: '0.6rem 0.9rem', borderRadius: '10px', fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🏦</span>
                    <span style={{ fontWeight: 600 }}>{c.institution_name}</span>
                    <FiCheckCircle style={{ color: '#10b981' }} />
                  </div>
                  <button
                    onClick={() => handleDeleteConnection(c.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: '0.2rem 0.4rem',
                      display: 'flex', alignItems: 'center', borderRadius: '6px',
                      transition: 'color 0.2s, background 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'hsla(0,100%,60%,0.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
                    title="Remove connection"
                  >
                    <FiTrash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button 
            className="btn" 
            onClick={() => open()} 
            disabled={!ready}
            style={{ background: '#fff', color: '#111', borderColor: '#fff', opacity: ready ? 1 : 0.5 }}
          >
            <FiLink2 /> {plaidConnected ? 'Connect Another Bank' : 'Connect Bank via Plaid'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
