# Technische specificatie: VeriPixel Browser Extension

## 1. Doel

Een browserextensie (Chrome/Edge, Manifest V3) die automatisch afbeeldingen op elke bezochte webpagina scant en aangeeft hoe waarschijnlijk het is dat een afbeelding AI-gegenereerd of AI-gemanipuleerd is. Alle inference gebeurt **client-side** (in de browser zelf) — er wordt geen afbeelding naar een externe server gestuurd, om privacy te waarborgen.

**Doelgroep use-cases:** vastgoedadvertenties (Funda e.d.), webshops, Marktplaats, dating-app profielfoto's — situaties waarin een gebruiker wil weten of een foto de werkelijkheid vertegenwoordigt## 2. Architectuur (overzicht)

```
┌─────────────────────────────────────────────┐
│  Content Script (per pagina)                 │
│  - detecteert <img>-elementen in de DOM      │
│  - filtert kleine/decoratieve afbeeldingen    │
│  - past IntersectionObserver toe (lazy)      │
│  - stuurt image-URL's naar background        │
└───────────────────┬───────────────────────────┘
                    │ chrome.runtime.sendMessage
┌───────────────────▼───────────────────────────┐
│  Background Service Worker (Router/Cache)     │
│  - beheert sessie-cache per image-URL         │
│  - beheert Offscreen Document levenscyclus    │
│  - voert CORS-safe fetch uit als ArrayBuffer  │
│  - stuurt image data & taken naar Offscreen   │
└───────────────────┬───────────────────────────┘
                    │ chrome.runtime.sendMessage / MessageChannel
┌───────────────────▼───────────────────────────┐
│  Offscreen Document (Execution Engine)        │
│  - volle DOM & WebGL/WebGPU-context           │
│  - beheert ONNX Runtime Web (`onnxruntime-web`)│
│  - Queue/Concurrency Limiter (max 2 parallel) │
│  - multi-patch cropping & tensor preprocess   │
│  - EXIF / C2PA / Quantisatie-analyse          │
└───────────────────┬───────────────────────────┘
                    │ resultaat: {score, details}
┌───────────────────▼───────────────────────────┐
│  Content Script: overlay-badge (Shadow DOM)   │
│  - toont badge geïsoleerd op/naast afbeelding │
│  - kleurcodering: groen/oranje/rood            │
│  - klik op badge → tooltip met details         │
└─────────────────────────────────────────────────┘
```

## 3. Tech stack

- **Manifest V3** (Chrome extension standaard; vereist service worker + offscreen document)
- **ONNX Runtime Web** (`onnxruntime-web`) — voert ONNX-modellen uit in de browser via WebAssembly/WebGPU binnen het Offscreen Document
- **TypeScript** (aanbevolen voor typeveiligheid en onderhoudbaarheid)
- **Vite** met `@crxjs/vite-plugin` of custom extension builder (Manifest V3 gebundelde scripts)
- **Shadow DOM** voor overlay badges om CSS-conflicten met de hostpagina te voorkomen

## 4. Model & Preprocessing

**Primair model:** `haywoodsloan/ai-image-detector-deploy` (SwinV2) of `Organika/sdxl-detector`
- Architektuur: SwinV2-classifier of ViT / SDXL-detector
- **Quantisatie:** Gebruik int8 of fp16 gequantiseerde ONNX-variant om de downloadomvang te verminderen (~40 MB vs ~300 MB) en WASM/WebGPU inference 3-4x te versnellen.
- Modelgrootte & Caching: Cachen in IndexedDB of CacheStorage via het Offscreen Document om herhaald downloaden te voorkomen.

**Model-eigenschappen & Input:**
- Input: RGB-afbeelding (224×224 px of modelafhankelijke resolutie), normalisatie met ImageNet mean/std of modelspecifieke waarden.
- Output: binaire classificatie (real/fake) met confidence-score 0–1.

**Multi-patch preprocessing op rasterlijn-kruispunten:**
- Snijd uit de afbeelding op volledige resolutie 4 crops van de modelverwachte grootte (bijv. 224×224), gecentreerd op de **rasterlijn-kruispunten** (1/3–2/3-regel uit de fotografie: punten op 1/3 en 2/3 van breedte × 1/3 en 2/3 van hoogte). Dit voorkomt verlies van forensische details (compressie-ruis, artifacts) door een te grote full-image resize.
- **Fallback bij kleine afbeeldingen:** Indien afmetingen < 224×224 px, gebruik centrerede crop of direct pas-maken met padding/resize.
- **Concurrency Limiter:** Verwerk maximaal 2 afbeeldingen parallel in de Offscreen Queue om de browser en GPU responsief te houden.

## 5. Aanvullend signaal: metadata & compressie-geschiedenis

- **CORS-safe data retrieval:** Afbeelding-bytes worden via de Background Service Worker binnengehaald als `ArrayBuffer` om CORS "Tainted Canvas" restricties op het Content Script te omzeilen.
- **EXIF-check:** Ontbrekende of gestripte EXIF-data wordt uitgelezen via `exifr` of custom parser.
- **C2PA/Content Credentials-check:** Uitlezen van JUMBF metadata blokken (zoals toegevoegd door Photoshop/Adobe Firefly/C2PA-camera's).
- **Compressie-generatie-schatting:** JPEG-quantisatietabel-analyse (DQT markers) om het aantal compressiegeneraties en de "kwaliteitsafstand" tot het origineel te bepalen.
- Metadata-scores worden apart in de tooltip getoond naast de AI-modelscore.

## 6. Implementatiefasen

### Fase 1 — Skeleton extensie & Build setup
- `manifest.json` met permissions: `activeTab`, `scripting`, `storage`, `offscreen`
- Vite build configuratie voor background service worker, content scripts, offscreen document en popup UI
- Basis content script met `IntersectionObserver` dat `<img>`-tags opzoekt en via messaging naar background stuurt
- Background service worker die Offscreen Document dynamisch aanmaakt (`chrome.offscreen.createDocument`)
- Popup UI die extensie-status en gedetecteerde afbeeldingen toont

### Fase 2 — Offscreen Document & Model-integratie
- `onnxruntime-web` toevoegen als dependency binnen het Offscreen Document
- CORS-safe image fetcher in Background Service Worker (`ArrayBuffer` transfer)
- Model laden en cachen in IndexedDB
- Preprocessing-pipeline in Offscreen Document: image bitmap → canvas → **multi-patch crop (1/3-2/3 regel)** → tensor → ONNX run → score aggregatie
- Metadata-pipeline (EXIF/C2PA/JPEG quantization analysis)
- Concurrency queue in Offscreen Document (max 2 parallelle inference-taken)

### Fase 3 — UI/overlay (Shadow DOM)
- Content script injecteert badge per geanalyseerde afbeelding via Shadow DOM host
- Kleurcodering: groen (<30% AI-waarschijnlijkheid), oranje (30–70%), rood (>70%)
- Hover/klik toont tooltip met score-opbouw (Model + EXIF + C2PA + Patch verdeling)
- Instellingen-popup: aan/uit per site, drempelwaarden aanpassen

### Fase 4 — Performance & UX
- Lazy scanning met `IntersectionObserver`
- Session caching per image-URL in background service worker
- Batch throttling bij scroll-intensieve pagina's (Marktplaats, Funda)
- Duidelijke statusindicatie ("Model wordt geladen...", "Bezig met scannen...") in popup en badges

### Fase 5 — Verfijning
- Whitelist/blacklist van domeinen
- Handmatige re-scan knop per foto of per pagina
- Exporteren van samenvatting

### Fase 6 — Optioneel: cloud-assisted semantische check (buiten MVP)
- Opt-in diepere check via vision-language model API voor semantische anomalieën (schaduwen, reflecties, anatomie).

## 7. Bekende beperkingen (te communiceren in de UI)

- Geen enkele detector is 100% accuraat; reken op fout-positieven bij zwaar gecomprimeerde, bewerkte of low-light foto's
- Modellen getraind op oudere generatoren (SDXL) generaliseren minder goed naar nieuwere modellen (Flux, Midjourney v6 e.d.)
- Detectie werkt op basis van statistische patronen, niet op harde bewijzen — presenteer resultaten als waarschijnlijkheid, nooit als zekerheid
- Veel online platforms (social media, Marktplaats) strippen EXIF-data automatisch bij upload.

## 8. Projectstructuur (voorstel)

```
ai-image-detector/
├── manifest.json
├── src/
│   ├── background/
│   │   └── service-worker.ts   # Message routing, CORS image fetcher, Offscreen lifecycle
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   ├── offscreen.ts        # ONNX runner & Queue manager
│   │   ├── patch-extractor.ts  # 4 patches op rasterlijn-kruispunten (1/3–2/3-regel)
│   │   └── preprocess.ts
│   ├── content/
│   │   ├── scanner.ts          # DOM image detection & IntersectionObserver
│   │   └── overlay.ts          # Shadow DOM badge & tooltip rendering
│   ├── metadata/
│   │   ├── exif-reader.ts
│   │   ├── c2pa-reader.ts
│   │   └── compression-analysis.ts
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.tsx
│   └── shared/
│       └── types.ts
├── models/                    # Quantized ONNX model files (of IndexedDB remote loader)
├── vite.config.ts
└── package.json
```

## 9. Acceptatiecriteria (MVP)

1. Extensie laadt zonder errors in Chrome (Manifest V3 met Service Worker & Offscreen Document)
2. Bij bezoek aan een pagina met afbeeldingen verschijnt via Shadow DOM binnen enkele seconden een badge per afbeelding
3. CORS-afbeeldingen van externe domeinen worden foutloos binnengehaald via de background fetcher
4. Badge-score is gebaseerd op 4 patches op de rasterlijn-kruispunten uit de volledige resolutie in het Offscreen Document
5. Metadata-score (EXIF/C2PA/compressie) wordt apart getoond naast de model-score
6. Geen netwerkverkeer naar externe servers voor de standaard lokale analyse (te verifiëren via DevTools Network-tab)
7. Werkt goed op test-sites (bijv. Funda listings en Marktplaats productpagina's)
─ popup/
│   │   └── popup.tsx
│   └── shared/
│       └── types.ts
├── models/                    # ONNX model files (of dynamisch gedownload)
├── vite.config.ts
└── package.json
```

## 9. Acceptatiecriteria (MVP)

1. Extensie laadt zonder errors in Chrome (Manifest V3)
2. Bij bezoek aan een pagina met afbeeldingen verschijnt binnen enkele seconden een badge per afbeelding
3. Badge-score is gebaseerd op 4 patches op de rasterlijn-kruispunten uit de volledige resolutie, niet op één enkele resize
4. Metadata-score (EXIF/C2PA/compressie) wordt apart getoond naast de model-score
5. Geen netwerkverkeer naar externe servers voor de standaard lokale analyse (te verifiëren via DevTools Network-tab); enige uitzondering is de expliciete opt-in cloud-check (fase 6)
6. Werkt op minstens 2 test-sites (bijv. een Funda-listing en een webshop-productpagina)
