# Functional Specification: Distribution Cabinet Layout & Physical Auto-Sizing (Aufbauplan)

## 1. Overview
Translates electrical circuit schematics and floor plan load demands into scale-accurate physical distribution cabinet enclosure designs.

## 2. Enclosure & DIN Rail Configuration
- **Cabinet Selection:** Select standard distribution enclosures specified by rows, columns, and total Pitch Module (TE) capacity per DIN rail.
- **Page & Grid Setup:** Custom page sizes (A4, A3, A2) and scale ratios (e.g., 1:5, 1:10).
- **Rail Customization:** Adjust height spacing, vertical rail distance, and usable TE width per rail.

## 3. Automatic Layout & Sizing Algorithms
- **Component Placement Engine:**
  - Drag-and-drop components onto DIN rails with automatic snapping and collision prevention.
  - Validate total occupied TE per rail against maximum rail capacity.
- **Terminal Strip Physical Length Calculation:**
  - Dynamically calculate total physical length ($	ext{mm}$) of terminal strips based on individual terminal block widths (e.g., 5.2mm per tier) + end brackets + partition plates.
- **Spatial Placeholders & Structural Annotations:**
  - Insert empty space placeholders, spare DIN-rail slots, cable duct representations, and structural mounting plate notes.
