# Functional Specification: Automated Numbering & Circuit Logic

## 1. Overview
Defines rules for auto-numbering, auto-labeling, and automated cross-referencing across the electrical system.

## 2. Automated Numbering Rules
- **Protection Devices (RCDs & Fuses):** Sequential identification prefixing (e.g., `-F1`, `-F2`, `-F3`, `-F101`). Options to number by board, by row, or sequentially across the entire project.
- **Terminal Strips & Terminals:**
  - Automatic sequential terminal numbering (`-X1:1`, `-X1:2`, `-X1:3`...).
  - Auto-assignment of terminal strip groups based on target destinations (e.g., external field devices vs. internal connections).

## 3. Advanced Circuit Logic
- **Feed Variants (Einspeisung):** Single-phase (1N~), Three-phase (3N~), Emergency/Generator feed-in, Phase selection switches, Transfer switches (Netzumschalter / NA-Schutz).
- **Direct Connectors:** Potential-free contact routing and internal distribution link lines.
- **Serial Actuator Wiring:** Support for daisy-chaining or looping channel outputs.
