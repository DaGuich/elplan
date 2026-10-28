# System Overview, Canvas Navigation & Unified Hierarchy

## 1. Executive Summary
This document specifies the core platform architecture for a unified electrical building planning application. The platform bridges architectural 2D floor plan layout (symbol placement, room detection, client consulting) with functional electrical circuit diagrams (Stromlaufplan) and scale DIN-rail cabinet assembly planning (Aufbauplan).

## 2. Spatial & Electrical Hierarchy Model
The system enforces a decoupled, flexible topology where physical spatial structures and electrical distribution networks are independently mapped:

- **Decoupled Floor & Distribution Topology:**
  - Distribution boards (`Unterverteilungen` / `Hauptverteilungen`) **do not** have a 1:1 relationship with building floors/levels.
  - A floor MAY contain **zero** distribution boards (circuits are fed upstream from a distribution board located on another floor).
  - A floor MAY contain **one or multiple** distribution boards (e.g., dedicated sub-boards for general power, HVAC, or smart bus automation).
  - A single distribution board MAY feed circuits, loads, and terminal strips spanning **multiple floors**.
- **Data Entity Mapping:**
  - `Project` -> `Building` -> `Floor` -> `Room` -> `ArchitecturalElement` (Physical spatial domain).
  - `Project` -> `DistributionBoard` -> `RCDGroup` -> `CircuitBreaker` -> `TerminalStrip` -> `Terminal` -> `Load` (Electrical circuit domain).
  - Cross-domain links map `ArchitecturalElement` (e.g., wall outlet) directly to `CircuitBreaker` / `Terminal`.

## 3. Persistent Blueprint & Asset Storage Architecture
- **Persistent Storage Adapter Interface:**
  - All uploaded blueprints, floor plans, vector files, and exported artifacts must be persisted via a unified storage abstraction layer.
  - Implement two production storage adapters:
    1. **Local / Network Filesystem Adapter:** For self-hosted on-premise installations (`/data/uploads/...`).
    2. **S3-Compatible Object Storage Adapter:** Supporting S3 API endpoints (AWS S3, MinIO, Ceph) with presigned URLs or direct streaming.
- **Asset Metadata & Coordinates Preservation:**
  - Blueprint asset records track file hash, scale calibration factor (pixels-to-millimeters), origin offset $(X_0, Y_0)$, rotation angle, and crop boundaries.
  - Replacing or updating an underlying blueprint file MUST preserve all existing symbol overlay coordinates, spatial rotations, and relative room polygon anchors.

## 4. UI Architecture & Viewport Interaction Rules
- **Dedicated Project Details Page / View:**
  - Project metadata (client details, site address, project status, global electrical parameters, building structural hierarchy, and pricing templates) MUST reside on a **dedicated Project Details page/route** (`/projects/:id/details`).
  - Project settings and metadata MUST NOT be embedded in or squeezed into collapsible canvas sidebars or modals.
- **Interactive Canvas Viewport (Pan & Zoom Navigation):**
  - **Panning:** Smooth multi-directional pan via middle-mouse drag, pointer drag mode, or two-finger trackpad gestures.
  - **Zooming:** High-precision zoom in/out centered dynamically around the current pointer position using the mouse scroll wheel or pinch gestures.
  - **Scroll Wheel Event Trapping:** Canvas viewport event listeners MUST trap all wheel events (`e.preventDefault()`) and stop event propagation to prevent any outer document or browser window scrolling (zero scroll bleed-through).

## 5. View Modes
The application provides four synchronized views over the same underlying project model:
1. **Architectural Floor Plan View (Planungs-/Beratungsmodus):** 2D canvas for blueprint overlay, symbol placement, room detection, dimensioning, and client presentation.
2. **Electrical Schematic View (Stromlaufplan):** Single-line / multi-line functional circuit schematics showing protection devices, smart bus channels, and terminal connections.
3. **Cabinet Layout View (Aufbauplan):** Scale-accurate physical layout of DIN-rail enclosures, components, and terminal row length calculations.
4. **Free Vector Drawing Canvas:** Layer for custom vector annotations, framing groups, and architectural callouts.
