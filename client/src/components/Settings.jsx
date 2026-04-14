import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiLink2, FiAlertCircle, FiSun, FiMoon, FiTrash2 } from 'react-icons/fi';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { usePlaidLink } from 'react-plaid-link';
import API_BASE from '../config';

const Settings = ({ theme = 'dark', onToggleTheme }) => {
  const [splitwiseConnected, setSplitwiseConnected] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullResult, setPullResult] = useState(null);
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidConnections, setPlaidConnections] = useState([]);
  const [linkToken, setLinkToken] = useState(null);
  const [linkTokenMetadata, setLinkTokenMetadata] = useState(null);
  const [updateModeConnId, setUpdateModeConnId] = useState(null);
  const [oauthRedirectMissing, setOauthRedirectMissing] = useState(false);
  const [csvImportStatus, setCSVImportStatus] = useState(null);
  const [csvImportLoading, setCSVImportLoading] = useState(false);
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

  const generateLinkToken = async (accessToken = null) => {
    try {
      if (accessToken) {
        // Update mode — skip redirect_uri logic, just pass access_token
        const res = await axios.post(`${API_BASE}/api/transactions/create_link_token`, { access_token: accessToken });
        setLinkToken(res.data.link_token);
        return;
      }

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
      setLinkTokenMetadata(res.data);
      localStorage.setItem('plaid_link_token', res.data.link_token);
      // Warn if redirect_uri isn't registered — OAuth banks like Bilt will fail
      if (res.data.oauth_redirect_missing) {
        setOauthRedirectMissing(true);
      } else {
        setOauthRedirectMissing(false);
      }
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

  const handlePullSplitwise = async () => {
    setPullLoading(true);
    setPullResult(null);
    try {
      const res = await axios.post(`${API_BASE}/api/splitwise/pull`);
      setPullResult(res.data.added === 0 ? 'Already up to date.' : `Imported ${res.data.added} expense${res.data.added === 1 ? '' : 's'} from Splitwise.`);
    } catch (e) {
      setPullResult('Failed to pull from Splitwise.');
    } finally {
      setPullLoading(false);
    }
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCSVImportLoading(true);
    setCSVImportStatus(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${API_BASE}/api/transactions/import-csv`, formData);
      setCSVImportStatus(`✓ Imported ${res.data.added} transaction${res.data.added === 1 ? '' : 's'}`);
      if (res.data.errors?.length > 0) {
        setCSVImportStatus(prev => prev + ` (${res.data.errors.length} errors)`);
      }
      await fetchStatus();
      e.target.value = ''; // Clear file input
    } catch (err) {
      setCSVImportStatus(`✗ Import failed: ${err.response?.data?.detail || 'Unknown error'}`);
    } finally {
      setCSVImportLoading(false);
    }
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

  const handleFixConnection = async (conn) => {
    try {
      // Pass redirect_uri so OAuth institutions (e.g. Bilt) can complete the OAuth flow
      const currentUrl = window.location.href.split('?')[0];
      const isLocalhost = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
      const body = isLocalhost ? {} : { redirect_uri: currentUrl };
      const res = await axios.post(
        `${API_BASE}/api/transactions/connections/${conn.id}/create_update_token`,
        body
      );
      setLinkToken(res.data.link_token);
      setLinkTokenMetadata(res.data);
      setUpdateModeConnId(conn.id);
    } catch(e) {
      const msg = e?.response?.data?.detail || 'Failed to start re-authentication.';
      alert(msg);
    }
  };

  const onSuccess = async (public_token, metadata) => {
    try {
      if (updateModeConnId) {
        await axios.patch(`${API_BASE}/api/transactions/connections/${updateModeConnId}/clear_error`);
        await fetchStatus();
        setUpdateModeConnId(null);
      } else {
        await axios.post(`${API_BASE}/api/transactions/set_access_token`, {
          public_token: public_token
        });
        await fetchStatus();
      }
    } catch (e) {
      console.error("Failed to set access token", e);
      const detail = e?.response?.data?.detail || e?.message || 'Unknown error';
      alert(`Failed to connect bank: ${detail}`);
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

  useEffect(() => {
    if (ready && updateModeConnId) {
      open();
    }
  }, [ready, updateModeConnId]);

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

          {splitwiseConnected ? (
            <div>
              <button
                className="btn btn-splitwise"
                onClick={handlePullSplitwise}
                disabled={pullLoading}
                style={{ opacity: pullLoading ? 0.7 : 1 }}
              >
                {pullLoading ? '⟳ Pulling…' : '⬇ Pull from Splitwise'}
              </button>
              {pullResult && (
                <p style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {pullResult}
                </p>
              )}
              <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Imports expenses added directly in Splitwise (last 6 months) into your Pushed tab.
              </p>
            </div>
          ) : (
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

          {/* OAuth redirect_uri warning — shown when Bilt-like OAuth banks can't complete login */}
          {oauthRedirectMissing && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.65rem 0.9rem',
              borderRadius: '10px',
              background: 'hsla(38,92%,50%,0.08)',
              border: '1px solid hsla(38,92%,50%,0.3)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 700, color: 'hsl(38,70%,40%)' }}>⚠️ OAuth banks (e.g. Bilt) can't connect yet.</span>
              <br />
              <span style={{ color: 'var(--text-secondary)' }}>
                Register <code style={{ fontFamily: 'monospace', background: 'var(--surface-overlay)', padding: '0 4px', borderRadius: 3 }}>{window.location.href.split('?')[0]}</code> as an allowed redirect URI in your{' '}
                <a href="https://dashboard.plaid.com" target="_blank" rel="noreferrer" style={{ color: 'hsl(220,90%,65%)', textDecoration: 'underline' }}>Plaid dashboard</a>.
              </span>
            </div>
          )}

          {plaidConnections.length > 0 && (
            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {plaidConnections.map(c => {
                // Use live Plaid item error if available, fall back to last_sync_error
                const activeError = c.plaid_item_error || c.last_sync_error;
                const needsReconnect = c.needs_reconnect || activeError === 'ITEM_LOGIN_REQUIRED' || activeError === 'INVALID_ACCESS_TOKEN';
                const errorMsg = activeError
                  ? activeError === 'ITEM_LOGIN_REQUIRED'
                    ? 'Bank requires re-authentication'
                    : activeError === 'INVALID_ACCESS_TOKEN'
                    ? 'Connection expired — please re-authenticate'
                    : `Sync error: ${activeError}`
                  : null;
                const hasLiabilities = c.billed_products?.includes('liabilities') || c.available_products?.includes('liabilities');
                return (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{
                      background: 'var(--surface-overlay)', border: `1px solid ${errorMsg ? 'hsla(38,92%,50%,0.4)' : 'var(--border-light)'}`,
                      padding: '0.6rem 0.9rem', borderRadius: '10px', fontSize: '0.85rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.1rem' }}>🏦</span>
                        <span style={{ fontWeight: 600 }}>{c.institution_name}</span>
                        {errorMsg
                          ? <span style={{ color: 'hsl(38,92%,50%)', fontSize: '1rem' }}>⚠️</span>
                          : <FiCheckCircle style={{ color: '#10b981' }} />
                        }
                        {hasLiabilities && !errorMsg && (
                          <span style={{ fontSize: '0.7rem', background: 'hsla(150,60%,40%,0.15)', color: '#10b981', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
                            CC
                          </span>
                        )}
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
                    {errorMsg && (
                      <div style={{
                        padding: '0.5rem 0.9rem',
                        borderRadius: '8px',
                        background: 'hsla(38,92%,50%,0.08)',
                        border: '1px solid hsla(38,92%,50%,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                      }}>
                        <span style={{ fontSize: '0.78rem', color: 'hsl(38,70%,40%)' }}>{errorMsg}</span>
                        <button
                          onClick={() => handleFixConnection(c)}
                          style={{
                            background: 'hsl(38,92%,50%)', border: 'none', cursor: 'pointer',
                            color: '#fff', padding: '0.25rem 0.65rem', borderRadius: '6px',
                            fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
                          }}
                        >
                          Re-authenticate
                        </button>
                      </div>
                    )}
                    {!errorMsg && needsReconnect && (
                      <div style={{
                        padding: '0.5rem 0.9rem',
                        borderRadius: '8px',
                        background: 'hsla(220,90%,50%,0.08)',
                        border: '1px solid hsla(220,90%,50%,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                      }}>
                        <span style={{ fontSize: '0.78rem', color: 'hsl(220,70%,60%)' }}>Re-link to enable CC products</span>
                        <button
                          onClick={() => handleFixConnection(c)}
                          style={{
                            background: 'hsl(220,90%,60%)', border: 'none', cursor: 'pointer',
                            color: '#fff', padding: '0.25rem 0.65rem', borderRadius: '6px',
                            fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
                          }}
                        >
                          Re-link
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bilt 2.0 CSV Import */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light)' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>📊 Bilt 2.0 Obsidian (CSV Import)</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
              <strong>Desktop only:</strong> Open Bilt on desktop → Transactions → View All → ⋯ → Download CSV → Upload here.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVImport}
                style={{ fontSize: '0.85rem', flex: 1 }}
                disabled={csvImportLoading}
              />
              {csvImportLoading && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>⟳ Importing...</span>}
            </div>
            {csvImportStatus && (
              <p style={{
                fontSize: '0.8rem',
                marginTop: '0.5rem',
                color: csvImportStatus.includes('✓') ? '#10b981' : '#ef4444'
              }}>
                {csvImportStatus}
              </p>
            )}
          </div>

          {/* Plaid Health Diagnostics */}
          {linkTokenMetadata && (
            <div style={{
              marginBottom: '1rem',
              padding: '1rem',
              borderRadius: '12px',
              background: 'var(--bg)',
              border: '1px solid var(--border-light)',
              fontSize: '0.85rem'
            }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                🔍 Integration Health
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
                {['transactions', 'auth', 'balance', 'liabilities'].map(prod => {
                  const isAccepted = linkTokenMetadata.accepted_products?.includes(prod);
                  return (
                    <div key={prod} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: isAccepted ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isAccepted ? '#10b981' : '#ef4444' }} />
                      <span style={{ textTransform: 'capitalize' }}>{prod}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: linkTokenMetadata.redirect_uri_status === 'accepted' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  <div style={{ 
                    width: 8, height: 8, borderRadius: '50%', 
                    background: linkTokenMetadata.redirect_uri_status === 'accepted' ? '#10b981' : linkTokenMetadata.redirect_uri_status === 'rejected' ? '#ef4444' : '#6b7280' 
                  }} />
                  <span>OAuth Redirect</span>
                </div>
              </div>

              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light)', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {!linkTokenMetadata.accepted_products?.includes('liabilities') && (
                  <p style={{ color: 'hsl(0,70%,60%)', marginBottom: '0.4rem' }}>
                    <strong>⚠️ Liabilities Disabled:</strong> Credit cards (like Bilt) may not show up. <strong>Enable "Liabilities"</strong> in your Plaid Dashboard (Production).
                  </p>
                )}
                {linkTokenMetadata.redirect_uri_status === 'rejected' && (
                  <p style={{ color: 'hsl(38,70%,40%)', marginBottom: '0.4rem' }}>
                    <strong>⚠️ OAuth Rejected:</strong> Banks like Bilt cannot link. Add <code>{window.location.href.split('?')[0]}</code> to <strong>Allowed Redirect URIs</strong> in your Plaid Dashboard.
                  </p>
                )}
                {linkTokenMetadata.accepted_products?.includes('liabilities') && linkTokenMetadata.redirect_uri_status === 'accepted' && (
                  <p style={{ color: '#10b981' }}>
                    ✨ All core systems active for Bilt Rewards.
                  </p>
                )}
              </div>
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

          {/* Institution search tips */}
          <div style={{
            marginTop: '0.85rem',
            padding: '0.65rem 0.9rem',
            borderRadius: '10px',
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-light)',
            fontSize: '0.78rem',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.3rem' }}>
              💡 Not finding your card? Search by servicer:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span><strong style={{ color: 'var(--text-primary)' }}>Bilt Mastercard</strong> → search <code style={{ background: 'var(--bg)', padding: '0 4px', borderRadius: 3, fontSize: '0.75rem' }}>Bilt Rewards</code></span>
              <span><strong style={{ color: 'var(--text-primary)' }}>Apple Card</strong> → search <code style={{ background: 'var(--bg)', padding: '0 4px', borderRadius: 3, fontSize: '0.75rem' }}>Goldman Sachs</code></span>
              <span><strong style={{ color: 'var(--text-primary)' }}>Venmo / PayPal</strong> → search <code style={{ background: 'var(--bg)', padding: '0 4px', borderRadius: 3, fontSize: '0.75rem' }}>PayPal</code></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
