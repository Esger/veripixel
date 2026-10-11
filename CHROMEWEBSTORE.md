# Chrome Web Store Listing — VeriPixel

> Last Updated: 2026-10-11

## Store Listing

**Extension Name** [REQUIRED]
VeriPixel: Image Authenticity & AI Detector

**Short Description** [REQUIRED]
Detects AI-generated and manipulated images on any webpage with real-time badges, patch forensics, and 100% on-device privacy.

**Detailed Description** [REQUIRED]
VeriPixel analyzes images on any webpage as you browse, calculating AI generation probability and detecting digital manipulations using 100% private, on-device forensics.

Tired of wondering if a viral photo, news image, or listing picture is authentic or AI-generated? VeriPixel inspects images directly within your browser, offering clear transparency into potential synthetic artifacts, localized alterations, and generative AI features.

HOW IT WORKS
1. Browse normally — VeriPixel monitors visible images on the page.
2. A subtle indicator badge appears in the corner of images above thumbnail size.
3. The badge displays an on-device probability estimate (from "No AI Signs" to "Possible AI" and "Likely AI").
4. Click any badge to open an interactive forensic inspection popover with multi-region patch scores, media classification, EXIF camera metadata, and manipulation analysis.

KEY FEATURES
• Real-Time Visual Badges — Evaluates images above thumbnail size (120×120px) without disrupting page layout.
• Regional Multi-Patch Inspection — Evaluates images across multiple crops to detect localized edits (face-swaps, inpainting, composite edits) alongside full-frame generations (Midjourney, DALL-E, Stable Diffusion, Flux).
• Interactive Bi-Directional Hover — Hovering over any sample in the popover highlights the corresponding region over the image, and hovering over any region highlights its score in the popover.
• Media-Aware Forensic Classifier — Dual-process engine (heuristic property triage + neural verification) tunes analysis for camera photographs, digital art, sketches, and interface screenshots.
• EXIF & Provenance Inspection — Reads embedded camera model, lens specifications, exposure parameters, software tags, and C2PA credentials.
• 100% Client-Side Privacy — Powered by ONNX Runtime Web with WASM SIMD running in an isolated Offscreen Document. No photos, URLs, or browsing history are ever uploaded to external servers.
• Fast & Responsive — Fast-pass triage provides instant visual feedback followed by full regional verification on demand.
• Toolbar Quick Controls — Toggle extension scanning globally on or off with a single click from the extension popup.

DISCLAIMER
VeriPixel provides probabilistic estimates based on visual characteristics, neural inference, and metadata inspection. AI detection technologies have inherent margins of error; verdicts indicate estimated probability rather than definitive proof of authenticity or synthetic generation.

WHY 100% ON-DEVICE PRIVACY MATTERS
Unlike cloud-based detectors that require uploading every image you view to a remote server, VeriPixel runs entirely on your local machine. Your browsing habits, personal photos, and viewed media remain strictly confidential on your computer.

PERMISSIONS EXPLAINED
• "Read and change all your data on the websites you visit" (<all_urls>): Required to scan image elements on web pages you view and render non-intrusive badge overlays. All analysis is 100% local on-device.
• "Storage": Used strictly to save your local extension preferences (such as enabling/disabling scanning).
• "Offscreen": Used to run WebAssembly neural network inference and canvas image cropping in an isolated background environment without freezing page interaction.

SUPPORT & FEEDBACK
Have a question, encountered an issue, or want to contribute? Visit our GitHub repository or contact support at esgerj+veripixel@gmail.com.

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
- Screenshot 1: Webpage showing indicator badge and forensic popover with sample region overlays.
- Screenshot 2: VeriPixel popup interface showing global on/off toggle, engine status, and tab summary.
- Screenshot 3: Multi-patch crop inspection with bi-directional hover and EXIF/C2PA verification report.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Persists user preferences locally on the device, such as the global enable/disable toggle and scanning sensitivity thresholds. |
| `offscreen` | permissions | ML-inferentie met ONNX Runtime Web en canvas-cropping, wat in een service worker niet kan. Executes neural network inference and canvas image manipulation inside an isolated offscreen document with WebAssembly SIMD without blocking service worker threads or web page rendering. |
| `<all_urls>` | host_permissions | De extensie scant afbeeldingen op elke pagina die de gebruiker bezoekt, volledig lokaal. Scans image elements on web pages visited by the user to perform client-side AI probability calculation and metadata inspection. All processing is 100% on-device; no image content, URLs, or browsing history are ever transmitted off the user's machine. |

*Note: `activeTab` was removed as redundant with `<all_urls>`. `web_accessible_resources` was removed completely to eliminate extension fingerprinting.*

---

## Privacy & Data Use (Chrome Developer Dashboard)

### Data Types Declaration
In the Chrome Developer Dashboard under **Privacy > Data Usage**:
- [x] Check **Website Content** (Afbeeldingen van webpagina's)
  - **Justification to enter in Dashboard:** "The extension accesses image elements displayed on web pages visited by the user solely to perform on-device AI detection and forensic metadata inspection. All image processing occurs strictly in local memory on the user's device and is never stored remotely, logged, or transmitted over any network."

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

## Third-Party Notices & Model License

- **Machine Learning Model (`model_q4.onnx`):** Swin Transformer V2 image detection model derived from `haywoodsloan/ai-image-detector-deploy`, quantized with ONNX Runtime for client-side web deployment. Licensed under Apache 2.0 / MIT License. Permits redistribution and public/commercial use.
- **ONNX Runtime Web:** Microsoft Corporation, MIT License.
- **Exifr:** Mike Kovařík, MIT License.
- **Lucide Icons:** Lucide Project, ISC License.
- See [`NOTICE.md`](NOTICE.md) for full licensing details.

---

## Packaging Guidelines

To generate a clean ZIP package without macOS resource forks (`__MACOSX/`) or `.DS_Store` files:
```bash
bash scripts/package-extension.sh
```
Or manually:
```bash
npm run build
cd dist && COPYFILE_DISABLE=1 zip -r -X ../veripixel-v0.2.0.zip . -x "*.DS_Store" -x "*__MACOSX*" -x "*/__MACOSX/*" -x "._*"
```

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
| 0.2.0 | 2026-10-11 | Dual-process System 1 heuristic classifier + System 2 ONNX neural pipeline, responsive CSS sample placement layout, bi-directional popover/region hover interaction, softened UI phrasing, and streamlined Manifest permissions. | Draft |
| 0.1.0 | 2026-09-23 | Initial release: client-side ONNX Runtime Web image detection, fast badge pass, regional deepening, EXIF inspection, and toolbar toggle. | Archived |

