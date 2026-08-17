# Grow System Extension

Home Assistant profile manager and dedicated control surface for a staged indoor grow system.

## Current scope (0.8.0)

- Optionally discovers Atlas Scientific EZO pH, EC, DO, and RTD circuits directly on Raspberry Pi I2C bus 1.
- Creates native Home Assistant sensor entities and polls them locally every 30 seconds.
- Shows `/dev/i2c-1` availability, discovered circuit addresses, types, and firmware in the panel Settings tab.
- Keeps native hardware support read-only; Motor HATs and dosing pumps cannot be actuated in this release.
- Supports automatic Atlas discovery plus persistent manual I2C addresses and a 10-300 second polling interval.
- Exposes guarded pH, EC, DO, and RTD calibration commands after an explicit confirmation.
- Discovers PCA9685 Motor HATs at `0x40`-`0x4f` using register reads only and lists them with outputs locked.

- Stores five profiles in one Home Assistant storage document.
- Provides a dedicated responsive profile editor panel.
- Uses Home Assistant cards, controls, spacing, and theme variables in the panel.
- Provides Overview, Profiles, and Settings tabs directly inside the panel.
- Shows current readings with 24-hour Recorder history charts.
- Lets administrators change device, sensor, and equipment mappings without opening the integration options dialog.
- Supports unlimited camera and moisture-sensor mappings with a security overview and water-alarm state.
- Uses a fixed four-camera desktop grid and keeps security directly below the stage tabs.
- Maps an RDWC water-level sensor and RDWC circulation pump; air-circulation fans remain outside automatic control.
- Lists incomplete required mappings in the panel header.
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

The profile editor and entity mappings are intentionally separate from the control engine. Saving a profile, selecting a stage, or mapping equipment in version 0.7.0 does not operate equipment.

## Raspberry Pi 5 and native Atlas I2C

The safest migration is a second microSD card:

1. Shut the Raspberry Pi down completely and label the existing MyCodo card. Do not erase it.
2. Flash the Raspberry Pi 5 Home Assistant OS image to a different microSD card.
3. Keep the InterLink i3 and probes physically connected, then boot the new HAOS card.
4. Enable I2C in HAOS by adding `dtparam=i2c1=on` and `dtparam=i2c_arm=on` to `config.txt`.
5. Load the `i2c-dev` and `i2c-bcm2708` host modules as documented by Home Assistant OS.
6. Install Grow System Extension and open Grow System → Settings → Local Raspberry Pi hardware.

If `/dev/i2c-1` is not available to Home Assistant Core, the integration remains usable and reports the exact diagnostic instead of failing setup. The old installation can be restored by powering down and reinserting the untouched MyCodo microSD card.
