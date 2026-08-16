"""Grow System Extension."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from .const import DOMAIN, PANEL_COMPONENT, PANEL_MODULE_URL, PANEL_PATH, PANEL_URL
from .entity_map import resolve_entities
from .hardware.coordinator import AtlasI2CCoordinator
from .store import GrowSystemStore
from .websocket_api import async_register

PLATFORMS = [Platform.SENSOR]


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
    configured = {**entry.data, **entry.options}
    hass.data[DOMAIN]["entry"] = entry
    hass.data[DOMAIN]["configured_entities"] = configured
    hass.data[DOMAIN]["entities"] = resolve_entities(hass, configured)

    atlas = AtlasI2CCoordinator(hass)
    hass.data[DOMAIN]["atlas_i2c"] = atlas
    if await atlas.async_initialize():
        await atlas.async_config_entry_first_refresh()
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def _async_options_updated(hass: HomeAssistant, updated: ConfigEntry) -> None:
        configured = {**updated.data, **updated.options}
        hass.data[DOMAIN]["configured_entities"] = configured
        hass.data[DOMAIN]["entities"] = resolve_entities(hass, configured)

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
    atlas = hass.data[DOMAIN].get("atlas_i2c")
    if atlas is not None and atlas.devices:
        await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    frontend.async_remove_panel(hass, PANEL_PATH)
    hass.data[DOMAIN].pop("store", None)
    hass.data[DOMAIN].pop("entry", None)
    hass.data[DOMAIN].pop("configured_entities", None)
    hass.data[DOMAIN].pop("entities", None)
    coordinator = hass.data[DOMAIN].pop("atlas_i2c", None)
    if coordinator is not None:
        await coordinator.async_shutdown()
    return True
