import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TabScanStats, ImageSummary } from '../shared/types';
import './popup.css';

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
    <div className="popupView">
      {/* Header */}
      <div className="popupView__header">
        <div className="popupView__brand">
          <div className="popupView__brandIcon">🛡️</div>
          <div className="popupView__brandText">
            <h2 className="popupView__title">AI Image Detector</h2>
            <span className="popupView__subtitle">Client-Side ONNX Engine</span>
          </div>
        </div>

        {/* Live scanning indicator badge */}
        <div className={`popupView__liveBadge ${stats.isScanning ? 'popupView__liveBadge--scanning' : ''}`}>
          <span className={`popupView__liveDot ${stats.isScanning ? 'popupView__liveDot--scanning' : ''}`} />
          {stats.isScanning ? 'Scanning...' : 'Live'}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="popupView__metricsGrid">
        <div className="popupView__metricCard">
          <div className="popupView__metricLabel">Scanned</div>
          <div className="popupView__metricValue">{loading ? '-' : stats.totalScanned}</div>
        </div>

        <div className="popupView__metricCard popupView__metricCard--fake">
          <div className="popupView__metricLabel">AI Fake</div>
          <div className="popupView__metricValue">{loading ? '-' : stats.aiDetected}</div>
        </div>

        <div className="popupView__metricCard popupView__metricCard--edited">
          <div className="popupView__metricLabel">Edited</div>
          <div className="popupView__metricValue">{loading ? '-' : stats.suspectedAi}</div>
        </div>

        <div className="popupView__metricCard popupView__metricCard--real">
          <div className="popupView__metricLabel">Real</div>
          <div className="popupView__metricValue">{loading ? '-' : stats.likelyReal}</div>
        </div>
      </div>

      {/* Scanned Images Feed */}
      <div className="popupView__feedSection">
        <div className="popupView__feedHeader">
          <span>DETECTED ON THIS TAB</span>
          <span>{stats.images.length} images</span>
        </div>

        {stats.images.length === 0 ? (
          <div className="popupView__emptyState">
            {stats.isScanning ? 'Analyzing visible images on page...' : 'No images over 224×224 found on this page.'}
          </div>
        ) : (
          <div className="popupView__imageList">
            {stats.images.map((img: ImageSummary, idx: number) => {
              const scorePercent = Math.round(img.aiScore * 100);
              let verdictClass = 'popupView__verdictBadge--real';
              let badgeLabel = 'Real';
              if (scorePercent >= 70) {
                verdictClass = 'popupView__verdictBadge--ai';
                badgeLabel = 'AI Gen';
              } else if (scorePercent >= 30) {
                verdictClass = 'popupView__verdictBadge--edited';
                badgeLabel = 'Edited';
              }

              return (
                <div
                  key={idx}
                  onClick={() => handleImageClick(img.imageUrl)}
                  className="popupView__imageCard"
                  title="Click to jump to image on page"
                >
                  <img src={img.imageUrl} alt="Preview" className="popupView__thumbnail" />
                  <div className="popupView__imageDetails">
                    <div className="popupView__tagGroup">
                      <span className={`popupView__verdictBadge ${verdictClass}`}>
                        {badgeLabel} {scorePercent}%
                      </span>
                      {img.c2paPresent && <span className="popupView__c2paTag">C2PA</span>}
                      {img.cameraModel && <span className="popupView__cameraTag">{img.cameraModel}</span>}
                    </div>
                    <div className="popupView__imageTitle">{img.reasoningTitle || img.imageUrl}</div>
                  </div>
                  <span className="popupView__jumpIcon">📍</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <button onClick={handleRescan} className="popupView__rescanBtn">
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
