# Privacy Policy for VeriPixel

**Last updated:** October 11, 2026

VeriPixel ("we", "our", or "the extension") is committed to protecting your privacy. This privacy policy explains how VeriPixel handles user data.

## Summary

- **Zero Data Collection:** VeriPixel does not collect, record, track, or sell any personal data, browsing history, or analyzed media.
- **100% On-Device Processing:** All image analysis and artificial intelligence inference occur entirely on your local device using client-side WebAssembly (ONNX Runtime Web).
- **No Remote Telemetry or Tracking:** No image pixels, URLs, metadata, or analytics are ever transmitted to any external server.

---

## 1. Information We Do Not Collect

When using VeriPixel:
- We **do not** collect your name, email address, IP address, or device identifiers.
- We **do not** collect or monitor your browsing history or visited URLs.
- We **do not** upload or store copies of web images you view or inspect.
- We **do not** use cookies, analytics libraries, or third-party trackers.

## 2. Website Content (Images) & Browser Permissions

### Website Content
VeriPixel reads image elements (`<img>`) displayed on web pages you browse exclusively in volatile browser memory to perform client-side AI probability scoring and metadata inspection. All analysis happens 100% on your device. No image pixels, page context, or browsing habits are ever retained, logged, or transmitted across any network.

### Permissions Used
VeriPixel requests only the minimal permissions required to function locally:

- **`<all_urls>` (Host Permissions):** Allows the extension's content script to detect and scan visible images on pages you browse, rendering non-intrusive on-screen authenticity badges and forensic popovers.
- **`storage`:** Used exclusively to store your personal extension preferences (such as enabling/disabling automatic scanning) locally inside your browser via `chrome.storage.local`.
- **`offscreen`:** Used to run neural network inference (ONNX Runtime Web with WebAssembly SIMD) and canvas image cropping inside an isolated offscreen document without blocking service worker threads or freezing web pages.

## 3. Data Storage and Retention

All preferences and temporary forensic cache entries are stored strictly in your browser's local sandbox (`chrome.storage.local` and `chrome.storage.session`). This data never leaves your computer and is purged automatically when tabs/browser sessions are closed or when the extension is uninstalled.

## 4. Third-Party Services

VeriPixel does not integrate with any third-party analytics, advertising, or external cloud API services.

## 5. Changes to This Policy

If we ever update this Privacy Policy, the revised version will be published here with an updated "Last updated" date.

## 6. Contact

If you have questions or concerns about this privacy policy, please contact us at:
- **Website:** https://ashware.nl/veripixel-privacy/
- **Email:** esgerj+veripixel@gmail.com
- **Repository:** https://github.com/Esger/veripixel
