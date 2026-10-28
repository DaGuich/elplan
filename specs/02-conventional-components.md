# Functional Specification: Conventional Electrical Components

## 1. Overview
This module defines standard (non-bus) electrical components, their physical attributes, and their electrical relationships within the schematic diagram.

## 2. Protection & Distribution Devices
### 2.1 Residual Current Devices (RCDs / FI-Schutzschalter)
- **Properties:** Pole count (2-pole, 4-pole), rated current (e.g., 25A, 40A, 63A), rated residual current (e.g., 30mA, 300mA), RCD type (Type A, Type F, Type B).
- **Behavior:** Acts as a parent/upstream node for downstream circuit breakers (MCBs). Associated downstream circuits inherit RCD protection context.

### 2.2 Miniature Circuit Breakers (MCBs / Leitungsschutzschalter) & Fuses
- **Properties:** Pole count (1-pole, 1-pole+N, 3-pole, 3-pole+N), tripping characteristic (B, C, D), rated current (6A, 10A, 16A, 20A, etc.).
- **Behavior:** Links directly to RCD protection groups or main supply feeds.

### 2.3 Terminal Blocks & Terminal Strips (Klemmen & Klemmleisten)
- **Types:** Single-level terminals, multi-level terminals (e.g., PE/N/L 3-tier installation terminals), neutral conductor disconnect terminals (N-Trennklemmen).
- **Rules:**
  - Automatic grouping of individual terminals into continuous terminal strips (e.g., `-X1`, `-X2`).
  - Terminal row size and width calculation based on component physical width specifications.

## 3. Relays & Contactors (Schütze / Relais)
- **Coil & Contact Relationships:**
  - Separation of control coil and operational contacts (NO - Normally Open, NC - Normally Closed, Changeover / Wechselkontakte).
  - Cross-referencing: Automatic tracking of contact locations linked to their parent coil across the schematic.
- **Applications:** Switching heavy loads, interlocks, heating controls, motor starters.
