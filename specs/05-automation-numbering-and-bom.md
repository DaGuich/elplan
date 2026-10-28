# Functional Specification: Auto-Numbering, Supply Logic & Quantity Take-off (BOM)

## 1. Auto-Numbering Systems
- **Protection & Circuit Devices:** Sequential identification prefixing (`-F1`, `-F2`, `-RCD1`, `-K1`). Configurable numbering scopes: by project, by sub-board, or by enclosure row.
- **Terminal Strips & Terminals:** Automatic sequential terminal numbering (`-X1:1`, `-X1:2`, `-X1:3`...) grouped by target destination (field cables vs. internal jumpers).
- **Architectural Elements:** Auto-assignment of ID codes and bus addresses to floor plan symbols.

## 2. Advanced Supply Logic & Feed Variants
- **Feed Configurations:** Single-phase (1N~), Three-phase (3N~), Emergency/Generator feed-in, Phase selector switches, Grid-tied PV feed, Transfer switches (Netzumschalter / NA-Schutz).
- **Direct Connectors:** Potential-free contact routing and internal distribution link lines.
- **Serial Actuator Wiring:** Support for daisy-chaining or looping channel outputs.

## 3. Quantity Take-off, Pricing Templates & List Generation (Listenansicht)
- **Pricing Templates (Preisvorlagen):** Custom unit price templates for hardware components, cabling per meter, and installation labor rates.
- **Tabular List View (Listenansicht):** Comprehensive tabular overview of all project elements with multi-select bulk inline editing.
- **Bill of Materials (BOM) Export:** Export complete hardware schedules, terminal plans, and cost estimates to CSV/Excel formats.
