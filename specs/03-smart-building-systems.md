# Functional Specification: Smart Building & Bus Automation Systems

## 1. Overview
Specifies the integration of intelligent building automation hardware, bus topologies, power distribution, and multi-channel actuators.

## 2. KNX Automation Infrastructure
- **Actuators:** Multi-channel switching actuators, dimming actuators, blind/shutter actuators, heating valve actuators.
- **Inputs & Sensors:** Binary inputs, push-button interfaces, room temperature controllers, presence detectors.
- **System Devices:** KNX power supplies (with/without choke), line couplers, IP interfaces/routers.
- **Logical Mapping:** Channel-level mapping to target loads, circuit breakers, and terminal blocks.

## 3. Loxone Ecosystem Integration
- **Central Controllers:** Miniserver (Gen 1 / Gen 2), Miniserver Compact, Extensions.
- **Power & Backup:** 24V DC Power Supplies, Loxone Power Supply & Backup 24V units.
- **Bus Networks:**
  - Loxone Tree Bus (Tree branches, Tree cabling representation).
  - Loxone Air (wireless endpoint mapping).
  - Link Bus (Miniserver-to-Extension communication).
- **Peripherals:** Audioserver, Stereo Extensions, Energy Meters, 24V peripheral power distribution.

## 4. Lighting Control Systems
- **24V LED Drivers & Controllers:** PWM dimmers, multi-channel RGB/RGBW/Tunable White controllers.
- **DALI Integration:** DALI Gateways, address mapping (broadcast, single address, group address), DALI line power supplies.

## 5. Additional Smart Systems & Access Control
- **Proprietary Bus Systems:** Busch-free@home®, Homematic IP Wired.
- **Access & Door Communications:** Door stations, indoor stations, access control modules (e.g., ekey fingerprint scanners, Gira door communication symbols).
