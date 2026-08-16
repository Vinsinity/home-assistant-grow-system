"""WebSocket API used by the Grow System panel."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import CONTROL_KEYS, DOMAIN, SENSOR_KEYS, STAGE_ORDER


@websocket_api.websocket_command({vol.Required("type"): "grow_system/config/get"})
@websocket_api.async_response
async def websocket_get_config(hass, connection, msg) -> None:
    """Return the complete compact profile document."""
    store = hass.data[DOMAIN]["store"]
    connection.send_result(
        msg["id"],
        {
            **store.data,
            "entities": hass.data[DOMAIN].get("entities", {}),
            "configured_entities": hass.data[DOMAIN].get(
                "configured_entities", {}
            ),
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/entities/save",
        vol.Required("values"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_save_entities(hass, connection, msg) -> None:
    """Persist panel-managed sensor and equipment mappings."""
    allowed = set(SENSOR_KEYS) | set(CONTROL_KEYS)
    clean = {}
    for key, value in msg["values"].items():
        if key not in allowed:
            continue
        if isinstance(value, str):
            clean[key] = value
        elif isinstance(value, list) and all(isinstance(item, str) for item in value):
            clean[key] = value

    entry = hass.data[DOMAIN]["entry"]
    current = {**entry.data, **entry.options}
    current.update(clean)
    hass.config_entries.async_update_entry(entry, options=current)
    connection.send_result(msg["id"], clean)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/profile/save",
        vol.Required("stage"): vol.In(STAGE_ORDER),
        vol.Required("values"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_save_profile(hass, connection, msg) -> None:
    """Save one stage profile."""
    store = hass.data[DOMAIN]["store"]
    try:
        profile = await store.async_update_profile(msg["stage"], msg["values"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_stage", str(err))
        return
    connection.send_result(msg["id"], profile)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/stage/select",
        vol.Required("stage"): vol.In(STAGE_ORDER),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_select_stage(hass, connection, msg) -> None:
    """Select a stage without enabling the future control engine."""
    store = hass.data[DOMAIN]["store"]
    store.data["active_stage"] = msg["stage"]
    await store.async_save()
    connection.send_result(msg["id"], {"active_stage": msg["stage"]})


def async_register(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_entities)
    websocket_api.async_register_command(hass, websocket_save_profile)
    websocket_api.async_register_command(hass, websocket_select_stage)
