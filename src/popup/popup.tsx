import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface Stats {
  total: number;
  analyzed: number;
  aiDetected: number;
}

const Popup: React.FC = () => {
  const [stats, setStats] = useState<Stats>({ total: 0, analyzed: 0, aiDetected: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PAGE_STATS' }, (response) => {
      if (response && response.stats) {
        setStats(response.stats);
      }
      setLoading(false);
    });
  }, []);

  return (
    <div style={{ padding: '16px', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '16px'
          }}
        >
          🔍
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>AI Image Detector</h2>
          <span style={{ fontSize: '11px', color: '#94A3B8' }}>Client-Side ONNX Engine (V3)</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
        <div
          style={{
            background: '#1E293B',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #334155'
          }}
        >
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>Scanned Images</div>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: '#38BDF8' }}>
            {loading ? '...' : stats.total}
          </div>
        </div>

        <div
          style={{
            background: '#1E293B',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #334155'
          }}
        >
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>AI Detected</div>
          <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px', color: '#F43F5E' }}>
            {loading ? '...' : stats.aiDetected}
          </div>
        </div>
      </div>

      {/* Status Section */}
      <div
        style={{
          background: '#1E293B',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid #334155',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              boxShadow: '0 0 6px #10B981'
            }}
          />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#F8FAFC' }}>
            Offscreen Engine Active
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: 1.4 }}>
          Processing 4-patch grid crops & metadata locally without external server transfers.
        </p>
      </div>

      {/* Action Footer */}
      <button
        onClick={() => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.reload(tabs[0].id);
              window.close();
            }
          });
        }}
        style={{
          width: '100%',
          padding: '10px',
          borderRadius: '8px',
          border: 'none',
          background: '#3B82F6',
          color: '#FFFFFF',
          fontWeight: 600,
          fontSize: '12px',
          cursor: 'pointer',
          transition: 'background 0.2s ease'
        }}
      >
        Re-scan Current Page
      </button>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
