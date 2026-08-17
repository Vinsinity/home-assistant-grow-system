"""WebSocket API used by the Grow System panel."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import CONTROL_KEYS, DOMAIN, SENSOR_KEYS, STAGE_ORDER
from .entity_map import resolve_entities


@websocket_api.websocket_command({vol.Required("type"): "grow_system/config/get"})
@websocket_api.async_response
async def websocket_get_config(hass, connection, msg) -> None:
    """Return the complete compact profile document."""
    store = hass.data[DOMAIN]["store"]
    configured = hass.data[DOMAIN].get("configured_entities", {})
    entities = resolve_entities(hass, configured)
    hass.data[DOMAIN]["entities"] = entities
    atlas = hass.data[DOMAIN].get("atlas_i2c")
    connection.send_result(
        msg["id"],
        {
            **store.data,
            "hardware_config": store.data.get("hardware", {}),
            "entities": entities,
            "configured_entities": configured,
            "hardware": {
                "atlas_i2c": atlas.diagnostic if atlas is not None else {
                    "available": False,
                    "error": "Native I2C coordinator is not initialized",
                }
            },
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


def _address(value) -> int:
    """Normalize and validate a user supplied 7-bit I2C address."""
    address = int(value, 0) if isinstance(value, str) else int(value)
    if not 0x08 <= address <= 0x77:
        raise ValueError("I2C address must be between 0x08 and 0x77")
    return address


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/save",
        vol.Required("poll_interval"): vol.All(int, vol.Range(min=10, max=300)),
        vol.Optional("device_assignments", default=[]): list,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_save_hardware(hass, connection, msg) -> None:
    """Save native I2C preferences and reload the integration."""
    try:
        assignments = []
        assigned = set()
        allowed_drivers = {
            "waveshare_motor_hat", "pca9685_generic",
            "atlas_do", "atlas_ph", "atlas_ec", "atlas_rtd",
        }
        for item in msg.get("device_assignments", []):
            address = _address(item.get("address"))
            driver = str(item.get("driver") or "")
            if driver not in allowed_drivers:
                raise ValueError(f"Unsupported I2C driver: {driver}")
            if address in assigned:
                continue
            assigned.add(address)
            assignments.append({
                "address": address,
                "driver": driver,
                "name": str(item.get("name") or f"I2C 0x{address:02X}")[:64],
            })
    except (TypeError, ValueError, AttributeError) as err:
        connection.send_error(msg["id"], "invalid_assignment", str(err))
        return
    store = hass.data[DOMAIN]["store"]
    hardware = await store.async_update_hardware(
        {
            "poll_interval": msg["poll_interval"],
            "device_assignments": assignments,
        }
    )
    connection.send_result(msg["id"], hardware)
    entry = hass.data[DOMAIN]["entry"]
    hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/calibration_status",
        vol.Required("address"): vol.Any(int, str),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_calibration_status(hass, connection, msg) -> None:
    """Read one Atlas circuit's calibration status."""
    try:
        address = _address(msg["address"])
        status = await hass.data[DOMAIN]["atlas_i2c"].async_calibration_status(address)
    except (TypeError, ValueError, OSError, RuntimeError) as err:
        connection.send_error(msg["id"], "calibration_status_failed", str(err))
        return
    connection.send_result(msg["id"], {"address": address, "status": status})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/calibrate",
        vol.Required("address"): vol.Any(int, str),
        vol.Required("operation"): str,
        vol.Optional("value"): vol.Any(int, float),
        vol.Required("confirmed"): True,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_calibrate(hass, connection, msg) -> None:
    """Run an explicitly confirmed and driver-validated calibration."""
    try:
        address = _address(msg["address"])
        result = await hass.data[DOMAIN]["atlas_i2c"].async_calibrate(
            address, msg["operation"], msg.get("value")
        )
    except (TypeError, ValueError, OSError, RuntimeError) as err:
        connection.send_error(msg["id"], "calibration_failed", str(err))
        return
    connection.send_result(msg["id"], {"address": address, "result": result})


def async_register(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_entities)
    websocket_api.async_register_command(hass, websocket_save_profile)
    websocket_api.async_register_command(hass, websocket_select_stage)
    websocket_api.async_register_command(hass, websocket_save_hardware)
    websocket_api.async_register_command(hass, websocket_calibration_status)
    websocket_api.async_register_command(hass, websocket_calibrate)
