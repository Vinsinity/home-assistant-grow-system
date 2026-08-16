# Grow System Extension

Home Assistant profile manager and dedicated control surface for a staged indoor grow system.

## Current scope (0.1.0)

- Stores five profiles in one Home Assistant storage document.
- Provides a dedicated responsive profile editor panel.
- Shows live sensor values beside the selected profile targets.
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

The profile editor is intentionally separate from the control engine. Saving or selecting a profile in version 0.1.0 does not operate equipment.
