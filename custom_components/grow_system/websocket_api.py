"""WebSocket API used by the Grow System panel."""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import CONTROL_KEYS, DEFAULT_CULTIVATION_PLAN, DOMAIN, SENSOR_KEYS, STAGE_ORDER
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
    cultivation = store.data.get("cultivation", {})
    if cultivation.get("active"):
        for block in cultivation.get("plan", []):
            if block.get("stage") == msg["stage"]:
                block["planned_days"] = max(1, min(365, int(profile["planned_days"])))
                await store.async_save()
                break
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
    """Select a stage for an active cultivation."""
    store = hass.data[DOMAIN]["store"]
    cultivation = store.data.get("cultivation", {})
    if not cultivation.get("active"):
        connection.send_error(
            msg["id"], "no_active_cultivation",
            "A stage cannot be activated before cultivation starts",
        )
        return
    store.data["active_stage"] = msg["stage"]
    transitions = cultivation.setdefault("transitions", [])
    if not transitions or transitions[-1].get("stage") != msg["stage"]:
        transitions.append({"stage": msg["stage"], "date": date.today().isoformat()})
    await store.async_save()
    connection.send_result(msg["id"], {"active_stage": msg["stage"]})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/cultivation/start",
        vol.Optional("name", default=""): str,
        vol.Optional("start_date", default=""): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_start_cultivation(hass, connection, msg) -> None:
    """Start a dated cultivation journal without forcing stage transitions."""
    store = hass.data[DOMAIN]["store"]
    if store.data.get("cultivation", {}).get("active"):
        connection.send_error(msg["id"], "already_active", "A cultivation is already active")
        return
    start_date = msg.get("start_date") or date.today().isoformat()
    try:
        date.fromisoformat(start_date)
    except ValueError:
        connection.send_error(msg["id"], "invalid_date", "Start date must be YYYY-MM-DD")
        return
    plan = []
    defaults_by_stage = {item["stage"]: item for item in DEFAULT_CULTIVATION_PLAN}
    for stage in STAGE_ORDER:
        defaults = defaults_by_stage[stage]
        profile = store.data["profiles"][stage]
        plan.append({
            **defaults,
            "planned_days": max(1, min(365, int(profile["planned_days"]))),
        })
    cultivation = {
        "active": True,
        "id": uuid4().hex,
        "name": (msg.get("name") or f"Yetiştirme · {start_date}")[:80],
        "start_date": start_date,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": "",
        "plan": plan,
        "transitions": [{"stage": "germination", "date": start_date}],
        "journal": {},
    }
    store.data["cultivation"] = cultivation
    store.data["active_stage"] = "germination"
    await store.async_save()
    connection.send_result(msg["id"], cultivation)


@websocket_api.websocket_command(
    {vol.Required("type"): "grow_system/cultivation/finish"}
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_finish_cultivation(hass, connection, msg) -> None:
    """Finish the active cultivation while retaining its journal."""
    store = hass.data[DOMAIN]["store"]
    cultivation = store.data.setdefault("cultivation", {})
    cultivation["active"] = False
    cultivation["completed_at"] = datetime.now(timezone.utc).isoformat()
    store.data["active_stage"] = None
    await store.async_save()
    connection.send_result(msg["id"], cultivation)


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
        vol.Optional("dosing_fluids", default=[]): list,
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
        incoming_required = {
            str(fluid.get("id")): fluid
            for fluid in msg.get("dosing_fluids", [])
            if isinstance(fluid, dict) and fluid.get("id") in {"ph_up", "ph_down"}
        }
        dosing_fluids = []
        for fluid_id, default_name in (("ph_up", "pH+"), ("ph_down", "pH−")):
            fluid = incoming_required.get(fluid_id, {})
            dosing_fluids.append({
                "id": fluid_id,
                "name": str(fluid.get("name") or default_name)[:64],
                "brand": str(fluid.get("brand") or "Belirtilmedi")[:64],
                "category": "ph",
                "catalog_id": str(fluid.get("catalog_id") or "")[:96],
                "line": str(fluid.get("line") or "")[:64],
                "part": str(fluid.get("part") or "")[:32],
                "npk": str(fluid.get("npk") or "")[:32],
                "phase": str(fluid.get("phase") or "")[:32],
                "medium": str(fluid.get("medium") or "")[:32],
                "ph_direction": str(fluid.get("ph_direction") or "")[:8],
                "required": True,
            })
        fluid_ids = {"ph_up", "ph_down"}
        for fluid in msg.get("dosing_fluids", []):
            fluid_id = str(fluid.get("id") or "")[:48]
            if not fluid_id or fluid_id in fluid_ids:
                continue
            if not fluid_id.replace("_", "").isalnum():
                raise ValueError(f"Invalid dosing fluid id: {fluid_id}")
            fluid_ids.add(fluid_id)
            dosing_fluids.append({
                "id": fluid_id,
                "name": str(fluid.get("name") or fluid_id)[:64],
                "brand": str(fluid.get("brand") or "Özel")[:64],
                "category": str(fluid.get("category") or "other")[:32],
                "catalog_id": str(fluid.get("catalog_id") or "")[:96],
                "line": str(fluid.get("line") or "")[:64],
                "part": str(fluid.get("part") or "")[:32],
                "npk": str(fluid.get("npk") or "")[:32],
                "phase": str(fluid.get("phase") or "")[:32],
                "medium": str(fluid.get("medium") or "")[:32],
                "ph_direction": str(fluid.get("ph_direction") or "")[:8],
                "required": False,
            })
        for item in msg.get("device_assignments", []):
            address = _address(item.get("address"))
            driver = str(item.get("driver") or "")
            if driver not in allowed_drivers:
                raise ValueError(f"Unsupported I2C driver: {driver}")
            if address in assigned:
                continue
            assigned.add(address)
            assignment = {
                "address": address,
                "driver": driver,
                "name": str(item.get("name") or f"I2C 0x{address:02X}")[:64],
            }
            if driver == "waveshare_motor_hat":
                incoming_channels = {
                    str(channel.get("id", "")).upper(): channel
                    for channel in item.get("channels", [])
                    if isinstance(channel, dict)
                }
                channels = []
                for channel_id in ("A", "B"):
                    channel = incoming_channels.get(channel_id, {})
                    fluid_id = str(
                        channel.get("fluid_id") or channel.get("role") or "unassigned"
                    )
                    if fluid_id != "unassigned" and fluid_id not in fluid_ids:
                        raise ValueError(f"Unknown dosing fluid: {fluid_id}")
                    channels.append({
                        "id": channel_id,
                        "name": str(channel.get("name") or f"Motor {channel_id}")[:64],
                        "fluid_id": fluid_id,
                        "pump": _pump_profile(channel.get("pump")),
                        "calibration": _motor_calibration(channel.get("calibration")),
                    })
                assignment["channels"] = channels
            assignments.append(assignment)
    except (TypeError, ValueError, AttributeError) as err:
        connection.send_error(msg["id"], "invalid_assignment", str(err))
        return
    store = hass.data[DOMAIN]["store"]
    previous = store.data.get("hardware", {})
    atlas_drivers = {"atlas_do", "atlas_ph", "atlas_ec", "atlas_rtd"}
    previous_atlas = {
        (item.get("address"), item.get("driver"))
        for item in previous.get("device_assignments", [])
        if item.get("driver") in atlas_drivers
    }
    next_atlas = {
        (item.get("address"), item.get("driver"))
        for item in assignments
        if item.get("driver") in atlas_drivers
    }
    reload_required = (
        previous_atlas != next_atlas
        or int(previous.get("poll_interval", 30)) != msg["poll_interval"]
    )
    hardware = await store.async_update_hardware(
        {
            "poll_interval": msg["poll_interval"],
            "device_assignments": assignments,
            "dosing_fluids": dosing_fluids,
        }
    )
    connection.send_result(
        msg["id"], {"hardware": hardware, "reloading": reload_required}
    )
    if reload_required:
        entry = hass.data[DOMAIN]["entry"]
        hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))


def _motor_calibration(value) -> dict | None:
    """Validate a measured pump calibration persisted by the panel."""
    if not isinstance(value, dict):
        return None
    seconds = float(value.get("seconds", 0))
    volume_ml = float(value.get("volume_ml", 0))
    speed = int(value.get("speed", 100))
    if not 1 <= seconds <= 30 or not 0 < volume_ml <= 500 or not 20 <= speed <= 100:
        raise ValueError("Invalid motor calibration measurement")
    return {
        "seconds": round(seconds, 2),
        "volume_ml": round(volume_ml, 3),
        "speed": speed,
        "flow_ml_s": round(volume_ml / seconds, 5),
        "calibrated_at": str(value.get("calibrated_at") or "")[:40],
    }


def _pump_profile(value) -> dict:
    """Validate the physical load attached to one Waveshare channel."""
    if not isinstance(value, dict):
        value = {
            "catalog_id": "nkp_dcl_s10y",
            "brand": "NKP",
            "model": "NKP-DCL-S10Y",
            "pump_type": "peristaltic_dc",
            "voltage": 12,
            "power_w": 5,
            "current_a": 0.417,
            "pwm": True,
            "reversible": True,
        }
    voltage = float(value.get("voltage", 0))
    power_w = float(value.get("power_w", 0))
    current_a = float(value.get("current_a") or (power_w / voltage if voltage else 0))
    if not 6 <= voltage <= 12:
        raise ValueError("Waveshare pump voltage must be between 6 and 12 V")
    if not 0 < current_a <= 1.2:
        raise ValueError("Pump current exceeds the Waveshare 1.2 A channel limit")
    return {
        "catalog_id": str(value.get("catalog_id") or "custom")[:64],
        "brand": str(value.get("brand") or "Özel")[:64],
        "model": str(value.get("model") or "DC peristaltik pompa")[:96],
        "pump_type": "peristaltic_dc",
        "voltage": round(voltage, 2),
        "power_w": round(power_w, 3),
        "current_a": round(current_a, 3),
        "flow_min_ml_min": round(float(value.get("flow_min_ml_min", 0)), 2),
        "flow_max_ml_min": round(float(value.get("flow_max_ml_min", 0)), 2),
        "pwm": bool(value.get("pwm", True)),
        "reversible": bool(value.get("reversible", True)),
        "verified": bool(value.get("verified", False)),
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/motor_test",
        vol.Required("address"): vol.Any(int, str),
        vol.Required("channel"): vol.In(("A", "B")),
        vol.Required("seconds"): vol.All(vol.Coerce(float), vol.Range(min=1, max=30)),
        vol.Required("speed"): vol.All(vol.Coerce(int), vol.Range(min=20, max=100)),
        vol.Required("confirmed"): True,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_motor_test(hass, connection, msg) -> None:
    """Run one short, confirmed pump test; the driver always stops afterward."""
    try:
        address = _address(msg["address"])
        await hass.data[DOMAIN]["atlas_i2c"].async_motor_test(
            address, msg["channel"], msg["seconds"], msg["speed"]
        )
    except (TypeError, ValueError, OSError, RuntimeError) as err:
        connection.send_error(msg["id"], "motor_test_failed", str(err))
        return
    connection.send_result(msg["id"], {
        "address": address,
        "channel": msg["channel"],
        "seconds": msg["seconds"],
        "speed": msg["speed"],
        "stopped": True,
    })


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


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/atlas_command",
        vol.Required("address"): vol.Any(int, str),
        vol.Required("command"): str,
        vol.Required("confirmed"): True,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_atlas_command(hass, connection, msg) -> None:
    """Run an explicitly confirmed Atlas management command."""
    try:
        address = _address(msg["address"])
        result = await hass.data[DOMAIN]["atlas_i2c"].async_device_command(
            address, msg["command"]
        )
    except (TypeError, ValueError, OSError, RuntimeError) as err:
        connection.send_error(msg["id"], "atlas_command_failed", str(err))
        return
    connection.send_result(
        msg["id"], {"address": address, "command": msg["command"], "result": result}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "grow_system/hardware/atlas_change_address",
        vol.Required("address"): vol.Any(int, str),
        vol.Required("new_address"): vol.Any(int, str),
        vol.Required("confirmed"): True,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_atlas_change_address(hass, connection, msg) -> None:
    """Change an Atlas address and its persisted assignment as one workflow."""
    try:
        old_address = _address(msg["address"])
        new_address = _address(msg["new_address"])
        if old_address == new_address:
            raise ValueError("New address is identical to the current address")
        store = hass.data[DOMAIN]["store"]
        assignments = store.data.get("hardware", {}).get("device_assignments", [])
        if any(int(item.get("address", -1)) == new_address for item in assignments):
            raise ValueError(f"I2C address 0x{new_address:02X} is already assigned")
        await hass.data[DOMAIN]["atlas_i2c"].async_change_address(
            old_address, new_address
        )
        for item in assignments:
            if int(item.get("address", -1)) == old_address:
                item["address"] = new_address
                break
        else:
            raise ValueError(f"No saved assignment exists at 0x{old_address:02X}")
        await store.async_save()
    except (TypeError, ValueError, OSError, RuntimeError) as err:
        connection.send_error(msg["id"], "atlas_address_change_failed", str(err))
        return
    connection.send_result(
        msg["id"], {"old_address": old_address, "new_address": new_address, "reloading": True}
    )
    entry = hass.data[DOMAIN]["entry"]
    hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))


def async_register(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_entities)
    websocket_api.async_register_command(hass, websocket_save_profile)
    websocket_api.async_register_command(hass, websocket_select_stage)
    websocket_api.async_register_command(hass, websocket_start_cultivation)
    websocket_api.async_register_command(hass, websocket_finish_cultivation)
    websocket_api.async_register_command(hass, websocket_save_hardware)
    websocket_api.async_register_command(hass, websocket_motor_test)
    websocket_api.async_register_command(hass, websocket_calibration_status)
    websocket_api.async_register_command(hass, websocket_calibrate)
    websocket_api.async_register_command(hass, websocket_atlas_command)
    websocket_api.async_register_command(hass, websocket_atlas_change_address)
