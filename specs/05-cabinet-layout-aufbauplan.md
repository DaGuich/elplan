# Functional Specification: Physical Cabinet Layout Plan (Aufbauplan)

## 1. Overview
Provides physical enclosure planning capabilities to ensure components fit into real-world distribution cabinets and meet spatial standards.

## 2. Enclosure & DIN Rail Configuration
- **Cabinet Selection:** Select standard distribution enclosures (rows, columns, total TE capacity per rail).
- **Page & Grid Setup:** Custom page sizes (A4, A3, A2) and scale ratios.
- **Rail Customization:** Adjust height, spacing, and usable TE width per DIN rail.

## 3. Automatic Layout & Sizing Algorithms
- **Component Placement:** Drag-and-drop components onto DIN rails with automatic snapping and collision prevention.
- **Terminal Strip Width Calculation:** Dynamically compute terminal strip lengths based on individual terminal widths (e.g., 5.2mm per terminal + end brackets + separators).
- **Placeholders & Notes:** Insert empty space placeholders, spare DIN-rail slots, and structural notes on the mounting plate.
