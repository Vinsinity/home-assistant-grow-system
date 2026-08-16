# Grow System Extension

Home Assistant profile manager and dedicated control surface for a staged indoor grow system.

## Current scope (0.4.0)

- Stores five profiles in one Home Assistant storage document.
- Provides a dedicated responsive profile editor panel.
- Uses Home Assistant cards, controls, spacing, and theme variables in the panel.
- Provides Overview, Profiles, and Settings tabs directly inside the panel.
- Shows current readings with 24-hour Recorder history charts.
- Lets administrators change device, sensor, and equipment mappings without opening the integration options dialog.
- Shows live sensor values beside the selected profile targets.
- Maps multiple environmental devices, automatically discovers their CO2, temperature, and humidity entities, and averages available readings.
- Calculates live VPD from the discovered average temperature and humidity.
- Maps VPD, nutrient PPM, pH, dissolved oxygen, and water-temperature sensors.
- Maps lights, CO2 valve, exhaust/inline/circulation fans, climate, dehumidifier, and chiller controls.
- Keeps the control engine disabled by default.
- Does not create dozens of `input_number` helpers.

## Install with HACS

1. In HACS, open **Integrations**.
2. Select the three-dot menu → **Custom repositories**.
3. Add `https://github.com/Vinsinity/home-assistant-grow-system` as an **Integration**.
4. Search for **Grow System Extension** and download it.
5. Restart Home Assistant.
6. Add **Grow System Extension** from Settings → Devices & services.

The **Grow System** panel is registered automatically. No YAML or SSH access is required after HACS installs the integration.

## Manual development install

Copy `custom_components/grow_system` into Home Assistant's `config/custom_components` directory, restart Home Assistant, and add the integration from Settings → Devices & services.

The profile editor and entity mappings are intentionally separate from the control engine. Saving a profile, selecting a stage, or mapping equipment in version 0.4.0 does not operate equipment.
