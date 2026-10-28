# Functional Specification: Component Engine, Bus Automation & Graphical Symbol Standards

## 1. Graphical Symbol Standards (DIN EN 60617 / IEC 60617)
- **Standardized Schematic Symbols:**
  - ALL standard electrical symbols used across schematics and floor plans MUST comply strictly with **DIN EN 60617 / IEC 60617** graphical symbols for diagrams.
  - Applies to switches, pushbuttons, protection devices (RCDs, MCBs), contacts, relays, contactors, transformers, measuring instruments, and architectural electrical installation symbols.
- **Representation Options:**
  - Support single-line (*einpolig*) and multi-line (*allpolig*) symbol representation modes.
  - Standardized terminal point markings and functional contact designations.

## 2. Conventional Electrical Components
- **Protection & Switching Devices:**
  - RCDs (2-pole, 4-pole; Type A, Type F, Type B; 25A, 40A, 63A; 30mA, 300mA).
  - MCBs (1-pole, 1-pole+N, 3-pole, 3-pole+N; tripping characteristics B, C, D; rated 6A to 63A).
  - Main switches, surge protection devices (SPD Type 1/2/3), phase selection switches.
- **Terminal Strips & Blocks:**
  - Single-level and multi-level installation terminals (PE/N/L 3-tier, N-disconnect terminals).
  - Automatic grouping of individual terminals into designated terminal strips (`-X1`, `-X2`).
  - Terminal physical width calculation for cabinet sizing.
- **Relays & Contactors:**
  - Physical separation of control coil and operational contacts (NO, NC, Changeover).
  - Automatic cross-referencing between coil position and contact locations across schematic pages.

## 3. Smart Building & Bus Automation Systems
- **KNX Infrastructure:** Actuators (switching, dimming, shutter/blind, heating), binary inputs, push-button interfaces, presence detectors, KNX power supplies (with choke), line couplers, IP routers.
- **Loxone Ecosystem:** Miniserver (Gen 1/2, Compact), Extensions, 24V DC Power Supplies & Backup, Tree Bus branches, Air endpoints, Link Bus, Audioserver, Energy Meters.
- **Lighting Controls:** 24V LED drivers, PWM dimmers, multi-channel RGB/RGBW/Tunable White controllers, DALI gateways, broadcast/individual address mapping.
- **Proprietary Bus & Door Systems:** Busch-free@home®, Homematic IP Wired, ekey fingerprint access, Gira door communication symbols.

## 4. Custom REG Device Builder & Symbol Library
- **Custom Modular Device (REG) Creator:** Define arbitrary DIN-rail devices specifying width in Pitch Modules (TE; $1 \text{ TE} = 18\text{mm}$), mounting type, pin labeling, and channel configurations (switching, dimming, 0-10V, binary input, bus connector).
- **Template Store:** User-level library saving and exportable XML/JSON component definition templates.
