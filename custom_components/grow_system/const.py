"""Constants and default profiles for Grow System Extension."""

from __future__ import annotations

DOMAIN = "grow_system"
STORAGE_KEY = f"{DOMAIN}.profiles"
STORAGE_VERSION = 1
PANEL_URL = "/grow-system-static/grow-system-panel.js"
PANEL_PATH = "grow-system"
PANEL_COMPONENT = "grow-system-panel"

STAGE_ORDER = ["germination", "early_veg", "veg", "bloom", "darkness"]

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
