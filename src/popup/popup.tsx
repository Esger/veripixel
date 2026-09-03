import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TabScanStats, ImageSummary } from '../shared/types';

const Popup: React.FC = () => {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [stats, setStats] = useState<TabScanStats>({
    tabId: 0,
    totalScanned: 0,
    aiDetected: 0,
    suspectedAi: 0,
    likelyReal: 0,
    isScanning: false,
    images: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Query the active tab and load its initial scan stats
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId !== undefined) {
        setActiveTabId(tabId);
        chrome.runtime.sendMessage({ type: 'GET_TAB_STATS', tabId }, (response) => {
          if (response && response.stats) {
            setStats(response.stats);
          }
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // 2. Listen for real-time background scan updates
    const handleMessage = (message: any) => {
      if (message.type === 'TAB_STATS_UPDATED') {
        setActiveTabId((currentTabId) => {
          if (currentTabId === null || message.stats.tabId === currentTabId) {
            setStats(message.stats);
          }
          return currentTabId;
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleImageClick = (imageUrl: string) => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, {
      type: 'HIGHLIGHT_IMAGE_ON_PAGE',
      imageUrl
    });
  };

  const handleRescan = () => {
    if (activeTabId) {
      chrome.tabs.reload(activeTabId);
      window.close();
    }
  };

  return (
    <div style={{ padding: '16px', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: '16px',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
            }}
          >
            🛡️
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, letterSpacing: '-0.2px' }}>AI Image Detector</h2>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>Client-Side ONNX Engine</span>
          </div>
        </div>

        {/* Live scanning indicator badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '12px',
            background: stats.isScanning ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${stats.isScanning ? '#3B82F6' : '#10B981'}`,
            fontSize: '10px',
            fontWeight: 600,
            color: stats.isScanning ? '#60A5FA' : '#34D399'
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: stats.isScanning ? '#3B82F6' : '#10B981',
              boxShadow: stats.isScanning ? '0 0 6px #3B82F6' : '0 0 6px #10B981'
            }}
          />
          {stats.isScanning ? 'Scanning...' : 'Live'}
        </div>
      </div>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '14px' }}>
        <div
          style={{
            background: '#1E293B',
            padding: '8px 6px',
            borderRadius: '8px',
            border: '1px solid #334155',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '10px', color: '#94A3B8' }}>Scanned</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px', color: '#F8FAFC' }}>
            {loading ? '-' : stats.totalScanned}
          </div>
        </div>

        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '8px 6px',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '10px', color: '#FCA5A5' }}>AI Fake</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px', color: '#EF4444' }}>
            {loading ? '-' : stats.aiDetected}
          </div>
        </div>

        <div
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            padding: '8px 6px',
            borderRadius: '8px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '10px', color: '#FCD34D' }}>Edited</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px', color: '#F59E0B' }}>
            {loading ? '-' : stats.suspectedAi}
          </div>
        </div>

        <div
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            padding: '8px 6px',
            borderRadius: '8px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '10px', color: '#6EE7B7' }}>Real</div>
          <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px', color: '#10B981' }}>
            {loading ? '-' : stats.likelyReal}
          </div>
        </div>
      </div>

      {/* Scanned Images Feed */}
      <div style={{ marginBottom: '14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#94A3B8'
          }}
        >
          <span>DETECTED ON THIS TAB</span>
          <span>{stats.images.length} images</span>
        </div>

        {stats.images.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              borderRadius: '8px',
              background: '#1E293B',
              border: '1px dashed #334155',
              color: '#64748B',
              fontSize: '12px'
            }}
          >
            {stats.isScanning ? 'Analyzing visible images on page...' : 'No images over 224×224 found on this page.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '230px', overflowY: 'auto' }}>
            {stats.images.map((img: ImageSummary, idx: number) => {
              const scorePercent = Math.round(img.aiScore * 100);
              let color = '#10B981';
              let badgeLabel = 'Real';
              if (scorePercent >= 70) {
                color = '#EF4444';
                badgeLabel = 'AI Gen';
              } else if (scorePercent >= 30) {
                color = '#F59E0B';
                badgeLabel = 'Edited';
              }

              return (
                <div
                  key={idx}
                  onClick={() => handleImageClick(img.imageUrl)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    background: '#1E293B',
                    border: '1px solid #334155',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease, background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#3B82F6';
                    e.currentTarget.style.background = '#283548';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#334155';
                    e.currentTarget.style.background = '#1E293B';
                  }}
                  title="Click to jump to image on page"
                >
                  <img
                    src={img.imageUrl}
                    alt="Preview"
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '4px',
                      objectFit: 'cover',
                      background: '#0F172A',
                      flexShrink: 0
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: `${color}20`,
                          border: `1px solid ${color}`,
                          color,
                          fontSize: '10px',
                          fontWeight: 700
                        }}
                      >
                        {badgeLabel} {scorePercent}%
                      </span>
                      {img.c2paPresent && (
                        <span style={{ fontSize: '9px', background: '#334155', padding: '1px 4px', borderRadius: '3px', color: '#93C5FD' }}>
                          C2PA
                        </span>
                      )}
                      {img.cameraModel && (
                        <span style={{ fontSize: '9px', background: '#334155', padding: '1px 4px', borderRadius: '3px', color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>
                          {img.cameraModel}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {img.reasoningTitle || img.imageUrl}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748B' }}>📍</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <button
        onClick={handleRescan}
        style={{
          width: '100%',
          padding: '9px',
          borderRadius: '8px',
          border: '1px solid #3B82F6',
          background: 'rgba(59, 130, 246, 0.15)',
          color: '#93C5FD',
          fontWeight: 600,
          fontSize: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          transition: 'background 0.2s ease, border-color 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.3)';
          e.currentTarget.style.borderColor = '#60A5FA';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
          e.currentTarget.style.borderColor = '#3B82F6';
        }}
      >
        <span>🔄</span> Re-scan Current Page
      </button>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
