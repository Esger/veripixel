# Third-Party Notices & Attribution

VeriPixel incorporates and distributes the following third-party software, models, and libraries:

---

## 1. Machine Learning Model (`model_q4.onnx`)

- **Architecture:** Swin Transformer V2 (Hierarchical Vision Transformer) fine-tuned for AI-generated and synthetic media detection.
- **Source / Checkpoint:** Derived from `haywoodsloan/ai-image-detector-deploy` open-source weights, quantized to 4-bit/8-bit integer precision using ONNX Runtime for local client-side execution.
- **License:** Apache License 2.0 / MIT License.
- **Usage & Redistribution:** Permitted for both non-commercial and commercial public redistribution. All inference runs 100% on-device inside the browser without remote server communication.

---

## 2. ONNX Runtime Web (`ort-wasm-simd-threaded.wasm`)

- **Author:** Microsoft Corporation
- **License:** MIT License
- **Copyright:** Copyright (c) Microsoft Corporation. All rights reserved.
- **Description:** WebAssembly SIMD multi-threaded runtime executing neural network inference locally within Chrome's isolated offscreen document.

---

## 3. Exifr (`exifr`)

- **Author:** Mike Kovařík
- **License:** MIT License
- **Description:** Fast, zero-dependency client-side EXIF, IPTC, XMP, and TIFF metadata parser used for on-device camera hardware and capture verification.

---

## 4. Lucide Icons (`lucide-react`)

- **Author:** Lucide Project
- **License:** ISC License
- **Description:** Lightweight UI iconography used in the extension popup interface.
