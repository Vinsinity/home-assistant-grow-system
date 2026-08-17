"""Constants and default profiles for Grow System Extension."""

from __future__ import annotations

DOMAIN = "grow_system"
CONF_ENVIRONMENT_DEVICES = "environment_devices"
CONF_CO2_SENSORS = "co2_sensors"
CONF_TEMPERATURE_SENSORS = "temperature_sensors"
CONF_HUMIDITY_SENSORS = "humidity_sensors"
CONF_VPD_SENSOR = "vpd_sensor"
CONF_PPM_SENSOR = "ppm_sensor"
CONF_PH_SENSOR = "ph_sensor"
CONF_DO_SENSOR = "do_sensor"
CONF_WATER_TEMPERATURE_SENSOR = "water_temperature_sensor"
CONF_WATER_LEVEL_SENSOR = "water_level_sensor"
CONF_LIGHT = "light"
CONF_CO2_VALVE = "co2_valve"
CONF_EXHAUST_FAN = "exhaust_fan"
CONF_INLINE_FAN = "inline_fan"
CONF_RDWC_PUMP = "rdwc_pump"
CONF_CLIMATE = "climate"
CONF_DEHUMIDIFIER = "dehumidifier"
CONF_CHILLER = "chiller"
CONF_CAMERAS = "cameras"
CONF_LEAK_SENSORS = "leak_sensors"

SENSOR_KEYS = (
    CONF_ENVIRONMENT_DEVICES,
    CONF_CO2_SENSORS,
    CONF_TEMPERATURE_SENSORS,
    CONF_HUMIDITY_SENSORS,
    CONF_VPD_SENSOR,
    CONF_PPM_SENSOR,
    CONF_PH_SENSOR,
    CONF_DO_SENSOR,
    CONF_WATER_TEMPERATURE_SENSOR,
    CONF_WATER_LEVEL_SENSOR,
    CONF_CAMERAS,
    CONF_LEAK_SENSORS,
)

CONTROL_KEYS = (
    CONF_LIGHT,
    CONF_CO2_VALVE,
    CONF_EXHAUST_FAN,
    CONF_INLINE_FAN,
    CONF_RDWC_PUMP,
    CONF_CLIMATE,
    CONF_DEHUMIDIFIER,
    CONF_CHILLER,
)
STORAGE_KEY = f"{DOMAIN}.profiles"
STORAGE_VERSION = 1
PANEL_URL = "/grow-system-static/grow-system-panel.js"
PANEL_MODULE_URL = f"{PANEL_URL}?v=0.17.4"
PANEL_PATH = "grow-system"
PANEL_COMPONENT = "grow-system-panel"

STAGE_ORDER = ["germination", "early_veg", "veg", "bloom", "darkness"]

DEFAULT_CULTIVATION_PLAN = [
    {"stage": "germination", "minimum_days": 4, "maximum_days": 8, "planned_days": 6},
    {"stage": "early_veg", "minimum_days": 10, "maximum_days": 15, "planned_days": 12},
    {"stage": "veg", "minimum_days": 21, "maximum_days": 28, "planned_days": 24},
    {"stage": "bloom", "minimum_days": 42, "maximum_days": 56, "planned_days": 49},
    {"stage": "darkness", "minimum_days": 3, "maximum_days": 3, "planned_days": 3},
]

DEFAULT_PROFILES = {
    "germination": {
        "name": "Germination",
        "photoperiod": 24,
        "light_intensity": 30,
        "day_temperature": 25,
        "night_temperature": 23,
        "humidity": 70,
        "vpd": 0.8,
        "co2": 450,
        "ppm": 300,
        "water_temperature": 19,
        "ph": 5.8,
        "do_minimum": 6,
    },
    "early_veg": {
        "name": "Early Veg",
        "photoperiod": 20,
        "light_intensity": 50,
        "day_temperature": 25,
        "night_temperature": 22,
        "humidity": 65,
        "vpd": 1.0,
        "co2": 800,
        "ppm": 500,
        "water_temperature": 19,
        "ph": 5.8,
        "do_minimum": 6,
    },
    "veg": {
        "name": "Veg",
        "photoperiod": 18,
        "light_intensity": 75,
        "day_temperature": 26,
        "night_temperature": 22,
        "humidity": 60,
        "vpd": 1.2,
        "co2": 900,
        "ppm": 700,
        "water_temperature": 19,
        "ph": 5.8,
        "do_minimum": 6,
    },
    "bloom": {
        "name": "Bloom",
        "photoperiod": 12,
        "light_intensity": 100,
        "day_temperature": 25,
        "night_temperature": 21,
        "humidity": 50,
        "vpd": 1.35,
        "co2": 850,
        "ppm": 800,
        "water_temperature": 19,
        "ph": 5.8,
        "do_minimum": 6,
    },
    "darkness": {
        "name": "Darkness",
        "photoperiod": 0,
        "light_intensity": 0,
        "day_temperature": 21,
        "night_temperature": 20,
        "humidity": 50,
        "vpd": 1.1,
        "co2": 450,
        "ppm": 800,
        "water_temperature": 19,
        "ph": 5.8,
        "do_minimum": 6,
    },
}
