"""Grow System Extension."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_CO2_SENSORS,
    CONF_ENVIRONMENT_DEVICES,
    CONF_HUMIDITY_SENSORS,
    CONF_TEMPERATURE_SENSORS,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_MODULE_URL,
    PANEL_PATH,
    PANEL_URL,
)
from .store import GrowSystemStore
from .websocket_api import async_register


def _resolve_entities(hass: HomeAssistant, configured: dict) -> dict:
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


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register the API once."""
    hass.data.setdefault(DOMAIN, {})
    async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load profiles and expose the panel asset."""
    store = GrowSystemStore(hass)
    await store.async_load()
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["entities"] = _resolve_entities(
        hass, {**entry.data, **entry.options}
    )

    async def _async_options_updated(hass: HomeAssistant, updated: ConfigEntry) -> None:
        hass.data[DOMAIN]["entities"] = _resolve_entities(
            hass, {**updated.data, **updated.options}
        )

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    panel_path = Path(__file__).parent / "frontend" / "grow-system-panel.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_URL, str(panel_path), False)]
    )
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title="Grow System",
        sidebar_icon="mdi:sprout",
        module_url=PANEL_MODULE_URL,
        require_admin=True,
        handle_safe_area=True,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the integration."""
    frontend.async_remove_panel(hass, PANEL_PATH)
    hass.data[DOMAIN].pop("store", None)
    hass.data[DOMAIN].pop("entities", None)
    return True
