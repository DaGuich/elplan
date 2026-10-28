# Functional Specification: Modular Device & Custom REG Device Builder

## 1. Overview
Allows users to define custom DIN-rail components (REG - Reiheneinbaugeräte) and non-standard hardware with arbitrary channel configurations and pinouts.

## 2. Custom Device Editor Requirements
- **Basic Metadata:** Brand/Manufacturer, Model designation, Width in TE (Teilungseinheiten / pitch modules; 1 TE = 18mm), mounting type (DIN rail, wall mount).
- **Channel Configuration:**
  - Define custom input/output channels.
  - Supported Channel Types: Switching contact, Dimmer output, 0-10V control output, Binary input, Analog input, Bus connection, Power supply terminal.
  - Pin labeling: Define custom terminal labels for each physical terminal point on the device.

## 3. Template Management System
- **Saving Templates:** Save custom defined REG components to a reusable user library.
- **Exporting/Importing Templates:** Share component definitions as JSON/XML spec templates between projects or users.
- **Bus/Line Coupler Functions:** Define special rules for devices that act as bus bridges or isolators.
