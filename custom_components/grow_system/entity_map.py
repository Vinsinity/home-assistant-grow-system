"""Resolve configured devices into sensor entities."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_CO2_SENSORS,
    CONF_ENVIRONMENT_DEVICES,
    CONF_HUMIDITY_SENSORS,
    CONF_TEMPERATURE_SENSORS,
)


def resolve_entities(hass: HomeAssistant, configured: dict) -> dict:
    """Resolve environmental sensor entities below selected devices."""
    resolved = dict(configured)
    device_ids = set(configured.get(CONF_ENVIRONMENT_DEVICES, []))
    if not device_ids:
        return resolved

    registry = er.async_get(hass)
    discovered = {
        CONF_CO2_SENSORS: [],
        CONF_TEMPERATURE_SENSORS: [],
        CONF_HUMIDITY_SENSORS: [],
    }
    class_to_key = {
        "carbon_dioxide": CONF_CO2_SENSORS,
        "temperature": CONF_TEMPERATURE_SENSORS,
        "humidity": CONF_HUMIDITY_SENSORS,
    }
    for state in hass.states.async_all("sensor"):
        entry = registry.async_get(state.entity_id)
        if entry is None or entry.device_id not in device_ids:
            continue
        device_class = state.attributes.get("device_class") or entry.original_device_class
        if key := class_to_key.get(str(device_class)):
            discovered[key].append(state.entity_id)

    for key, entity_ids in discovered.items():
        manual = configured.get(key, [])
        resolved[key] = list(dict.fromkeys([*entity_ids, *manual]))
    return resolved
