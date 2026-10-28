# Functional Specification: Floorplan Symbols, Room Detection & Circuit Mapping

## 1. Overview
This module governs architectural 2D floor plan editing, automated room polygon detection, symbol placement, wall box grouping (Montageorte), and bi-directional linking to electrical schematic circuits.

## 2. Automated Room Detection & Geometry
- **Algorithmic Boundary Parsing:**
  - Automatically parse vector lines or raster walls from uploaded CAD/PDF blueprints to identify enclosed room contours.
  - Generate closed interactive room boundary polygons automatically.
- **Area Calculation & Room Metadata:**
  - Calculate enclosed floor surface area ($m^2$) automatically based on calibrated blueprint scale.
  - Auto-label room names and types (e.g., Kitchen, Bathroom, Living Room, Office, Utility Room).
  - Pre-assign default electrical equipment densities based on installation standards (e.g., RAL-RG 678 star rating levels).
- **Manual Geometry Overrides:**
  - Interactive polygon vertex editing (add, move, delete vertices).
  - Split room polygons, merge adjacent polygons, or manually draw custom room regions.

## 3. Architectural Placement & Wall Mounting Locations (Montageorte)
- **Symbol Placement:** Drag-and-drop electrical symbols onto the 2D floor plan with snapping to walls, grid lines, and room boundaries.
- **Mounting Locations (Montageorte):**
  - Grouping individual symbols into physical wall mounting boxes (e.g., 3-gang switch/outlet combination box).
  - Support mounting location offset, rotation relative to wall angle, and merging/unmerging of adjacent mounting boxes.

## 4. Bi-Directional Floorplan-to-Schematic Linking
- **Circuit & Fuse Assignment:**
  - Assign floor plan symbols directly to upstream distribution boards, RCD groups (`-F1`), and circuit breaker channels.
- **Switched Groups & Actuator Channels:**
  - Link floor plan switches, pushbuttons, and sensors directly to smart bus actuator channels (KNX, Loxone, DALI) or relay coils in the schematic view.
- **Bi-Directional State Synchronization:**
  - Changing a component label, target destination, or fuse assignment in either the floor plan view or the schematic view automatically synchronizes across all views and data tables.
