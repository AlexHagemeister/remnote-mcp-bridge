/**
 * MCP Bridge Widget
 *
 * display-only widget that shows connection status.
 * websocket connection is managed in index.tsx, not here.
 */

import { renderWidget } from '@remnote/plugin-sdk';
import React, { useEffect, useState } from 'react';
import { connectionState, ConnectionState } from './index';

function MCPBridgeWidget() {
  
  // local state that syncs with global connection state
  const [status, setStatus] = useState<ConnectionState['status']>(connectionState.status);
  const [stats, setStats] = useState(connectionState.stats);
  const [logs, setLogs] = useState(connectionState.logs);

  // poll global state for updates
  useEffect(() => {
    
    const interval = setInterval(() => {
      
      setStatus(connectionState.status);
      setStats({ ...connectionState.stats });
      setLogs([...connectionState.logs]);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // status colors and icons
  const statusConfig = {
    connected: { color: '#22c55e', bg: '#dcfce7', icon: '●', text: 'Connected' },
    connecting: { color: '#f59e0b', bg: '#fef3c7', icon: '◐', text: 'Connecting...' },
    disconnected: { color: '#ef4444', bg: '#fee2e2', icon: '○', text: 'Disconnected' },
    error: { color: '#ef4444', bg: '#fee2e2', icon: '✕', text: 'Error' },
  };

  const currentStatus = statusConfig[status];

  return (
    <div style={{ padding: '12px', fontFamily: 'system-ui, sans-serif', fontSize: '13px' }}>
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>MCP Bridge</h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderRadius: '12px',
            backgroundColor: currentStatus.bg,
            color: currentStatus.color,
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          <span>{currentStatus.icon}</span>
          <span>{currentStatus.text}</span>
        </div>
      </div>

      {/* stats section */}
      <div
        style={{
          marginBottom: '12px',
          padding: '10px',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: '#6b7280' }}>
          SESSION STATS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#22c55e' }}>+</span>
            <span>Created: {stats.created}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#3b82f6' }}>~</span>
            <span>Updated: {stats.updated}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#8b5cf6' }}>#</span>
            <span>Journal: {stats.journal}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#f59e0b' }}>?</span>
            <span>Searches: {stats.searches}</span>
          </div>
        </div>
      </div>

      {/* logs section */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '8px 10px',
            borderBottom: '1px solid #e5e7eb',
            color: '#6b7280',
          }}
        >
          LOGS
        </div>
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ padding: '12px', color: '#9ca3af', textAlign: 'center' }}>
              No logs yet
            </div>
          ) : (
            logs
              .slice()
              .reverse()
              .map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '6px 10px',
                    borderBottom: index < logs.length - 1 ? '1px solid #e5e7eb' : 'none',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ color: '#9ca3af' }}>
                    {log.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    style={{
                      marginLeft: '8px',
                      color:
                        log.level === 'error'
                          ? '#ef4444'
                          : log.level === 'success'
                          ? '#22c55e'
                          : log.level === 'warn'
                          ? '#f59e0b'
                          : '#374151',
                    }}
                  >
                    {log.message}
                  </span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

renderWidget(MCPBridgeWidget);
