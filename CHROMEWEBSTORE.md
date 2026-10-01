# Chrome Web Store Listing — VeriPixel

> Last Updated: 2026-09-23

## Store Listing

**Extension Name** [REQUIRED]
VeriPixel: Image Authenticity & AI Detector

**Short Description** [REQUIRED]
Detects AI-generated and manipulated images on any webpage with real-time badges, patch forensics, and 100% on-device privacy.

**Detailed Description** [REQUIRED]
VeriPixel detects AI-generated, synthetic, and manipulated images on any webpage as you browse, using 100% private, on-device AI forensics.

Tired of wondering if a viral photo, news image, or social media post is authentic or AI-generated? VeriPixel inspects images in real time directly within your browser, giving you instant transparency into digital manipulations, face-swaps, and generative AI artifacts.

HOW IT WORKS
1. Browse normally — VeriPixel automatically monitors visible images on the page.
2. A subtle authenticity badge appears in the corner of images above thumbnail size.
3. The badge displays an authenticity assessment (from authentic photo to high AI likelihood).
4. Click any completed badge to open an interactive forensic inspection popover with in-depth patch scores, EXIF camera metadata, and manipulation analysis.

KEY FEATURES
• Real-Time Visual Badges — Automatically scans images above thumbnail size (120×120px) without disrupting page layout.
• Regional Deepening & Heatmaps — Divides images into multiple patches to detect localized edits like inpainting, face-swaps, and composite photo manipulation alongside full-frame generations (Midjourney, DALL-E, Stable Diffusion, Flux).
• Forensic Insights — Classifies signals into clear categories: Uniform Synthetic Artifacts, Localized Inpainting / Swap, Authentic Photographic Texture, or Ambiguous/Filtered.
• EXIF & Provenance Inspection — Reads embedded camera model, lens specifications, exposure parameters, software tags, and C2PA credentials.
• 100% Client-Side Privacy — Powered by ONNX Runtime Web with WASM SIMD running in an isolated Offscreen Document. No photos, URLs, or browsing history are ever uploaded to external servers.
• Fast & Lightweight — Uses an optimized fast-pass pipeline that displays initial verdicts in milliseconds without slowing down your browser.
• Toolbar Quick Controls — Toggle extension scanning globally on or off with a single click from the extension popup.

WHY 100% ON-DEVICE PRIVACY MATTERS
Unlike cloud-based detectors that require uploading every image you view to a remote server, VeriPixel runs entirely on your local machine. Your browsing habits, personal photos, and viewed media remain strictly confidential on your computer.

PERMISSIONS EXPLAINED
• "Read and change all your data on the websites you visit": Required to scan image elements on web pages you view and render the non-intrusive badge overlays.
• "Storage": Used strictly to save your local extension preferences (such as enabling/disabling scanning).
• "Offscreen": Used to run WebAssembly neural network inference in an isolated background thread without freezing the page.

SUPPORT & FEEDBACK
Have a question, encountered an issue, or want to contribute? Visit our GitHub repository or contact support at contact@veripixel.app.

**Category** [REQUIRED]
Photos

**Single Purpose** [REQUIRED]
Detects AI-generated and manipulated images directly in the browser with on-device forensic analysis.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `dist/assets/icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-1-badge-overlay.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-2-popup-controls.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-3-regional-deepening.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | `store-assets/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | `store-assets/promo-marquee-1400x560.png` |

### Screenshot Notes
- Screenshot 1: Webpage showing authenticity badge overlay on an AI-generated image with confidence score tooltip.
- Screenshot 2: VeriPixel popup interface showing global on/off toggle, engine status, and sensitivity controls.
- Screenshot 3: Modal dialog showing regional multi-patch heatmap and EXIF/C2PA verification report.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Enables on-demand authenticity inspection and badge overlays on images in the currently focused tab when the user interacts with the extension. |
| `storage` | permissions | Persists user preferences locally on the device, such as the global enable/disable toggle and scanning sensitivity thresholds. |
| `offscreen` | permissions | Executes ONNX Runtime Web inference inside an isolated offscreen document with WebAssembly SIMD support without blocking service worker threads or web page rendering. |
| `<all_urls>` | host_permissions | Allows scanning and reading image elements on any web page visited by the user to perform client-side AI detection and metadata analysis. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All image decoding, feature extraction, and neural network inference occur locally inside the browser. No personal data, browsing history, image content, or telemetry is gathered or transmitted off the user's device.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED — due to host permissions]
`https://ashware.nl/veripixel-privacy/`
*(Alternative / GitHub mirror: `https://github.com/Esger/veripixel/blob/main/PRIVACY.md`)*

---

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free

---

## Developer Info

**Publisher Name** [REQUIRED]
VeriPixel

**Contact Email** [REQUIRED]
esgerj+veripixel@gmail.com

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-09-23 | Initial release: client-side ONNX Runtime Web image detection, fast badge pass, regional deepening, EXIF inspection, and toolbar toggle. | Draft |
