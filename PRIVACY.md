# Privacy Policy for VeriPixel

**Last updated:** October 2, 2026

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

## 2. Permissions and How They Are Used

VeriPixel requests the following minimal browser permissions strictly to perform its local functionality:

- **`<all_urls>` (Host Permissions):** Allows the extension's content script to detect visible `<img>` tags on web pages you browse, enabling the display of real-time authenticity badges and inspection overlays. No webpage content is copied or exfiltrated.
- **`activeTab`:** Enables on-demand forensic inspection and badge interaction when you interact with an image or the extension on the active tab.
- **`storage`:** Used exclusively to store your personal extension preferences (such as enabling/disabling automatic scanning) locally inside your browser via `chrome.storage.local`.
- **`offscreen`:** Used to run neural network inference and canvas image rendering inside an isolated offscreen document via WebAssembly SIMD without freezing browser tabs.

## 3. Data Storage and Retention

All preferences and temporary forensic cache entries are stored strictly in your browser's local sandbox (`chrome.storage.local` and `chrome.storage.session`). This data never leaves your computer and is purged automatically when tabs/browser sessions are closed or when the extension is uninstalled.

## 4. Third-Party Services

VeriPixel does not integrate with any third-party analytics, advertising, or external cloud API services.

## 5. Changes to This Policy

If we ever update this Privacy Policy, the revised version will be published here with an updated "Last updated" date.

## 6. Contact

If you have questions or concerns about this privacy policy, please contact us at:
- **Website:** https://ashware.nl/veriPixel
- **Email:** esgerj+veripixel@gmail.com
- **Repository:** https://github.com/Esger/veripixel
