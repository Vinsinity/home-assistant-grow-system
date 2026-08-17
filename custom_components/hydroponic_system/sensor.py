"""Sensor entities supplied directly by Atlas EZO I2C circuits."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .hardware.atlas_ezo import AtlasDevice
from .hardware.coordinator import AtlasI2CCoordinator


@dataclass(frozen=True, slots=True)
class AtlasChannel:
    """Description of one numeric channel in an EZO response."""

    suffix: str
    name: str
    index: int
    unit: str | None


PRIMARY_CHANNELS = {
    "ph": AtlasChannel("ph", "pH", 0, "pH"),
    "do": AtlasChannel("do", "Dissolved Oxygen", 0, "mg/L"),
    "ec": AtlasChannel("ec", "Conductivity", 0, "µS/cm"),
    "rtd": AtlasChannel("temperature", "Water Temperature", 0, UnitOfTemperature.CELSIUS),
}

EC_OPTIONAL_CHANNELS = (
    AtlasChannel("tds", "TDS", 1, "ppm"),
    AtlasChannel("salinity", "Salinity", 2, "PSU"),
    AtlasChannel("specific_gravity", "Specific Gravity", 3, None),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create sensors for circuits found during safe discovery."""
    runtime = hass.data[DOMAIN].setdefault("sensor_runtime", {})
    runtime["async_add_entities"] = async_add_entities
    runtime.setdefault("known_unique_ids", set())
    await async_sync_atlas_entities(hass, entry)


async def async_sync_atlas_entities(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Add newly enrolled Atlas channels without reloading the integration."""
    runtime = hass.data[DOMAIN].get("sensor_runtime")
    if not runtime or "async_add_entities" not in runtime:
        return
    coordinator: AtlasI2CCoordinator = hass.data[DOMAIN]["atlas_i2c"]

    entities: list[AtlasEzoSensor] = []
    known: set[str] = runtime.setdefault("known_unique_ids", set())
    for device in coordinator.devices:
        primary = PRIMARY_CHANNELS.get(device.device_type.lower())
        if primary is None:
            continue
        candidates = [primary]

        values = coordinator.data.get(device.key, {}).get("values", ())
        if device.device_type.lower() == "ec":
            candidates.extend(
                channel for channel in EC_OPTIONAL_CHANNELS
                if channel.index < len(values)
            )
        for channel in candidates:
            unique_id = f"{entry.entry_id}_atlas_{device.address:02x}_{channel.suffix}"
            if unique_id in known:
                continue
            known.add(unique_id)
            entities.append(AtlasEzoSensor(coordinator, entry, device, channel))
    if entities:
        runtime["async_add_entities"](entities)


class AtlasEzoSensor(CoordinatorEntity[AtlasI2CCoordinator], SensorEntity):
    """One value reported by a native Atlas EZO circuit."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AtlasI2CCoordinator,
        entry: ConfigEntry,
        device: AtlasDevice,
        channel: AtlasChannel,
    ) -> None:
        super().__init__(coordinator)
        self._device = device
        self._channel = channel
        self._attr_name = f"Atlas {channel.name}"
        self._attr_unique_id = (
            f"{entry.entry_id}_atlas_{device.address:02x}_{channel.suffix}"
        )
        self._attr_native_unit_of_measurement = channel.unit
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"atlas_ezo_{device.address:02x}")},
            "name": f"Atlas EZO {device.device_type}",
            "manufacturer": "Atlas Scientific",
            "model": f"EZO-{device.device_type}",
            "sw_version": device.firmware,
        }

    @property
    def native_value(self) -> float | None:
        values = self.coordinator.data.get(self._device.key, {}).get("values", ())
        if self._channel.index >= len(values):
            return None
        return round(values[self._channel.index], 3)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "i2c_address": f"0x{self._device.address:02x}",
            "i2c_bus": self.coordinator.bus_number,
            "firmware": self._device.firmware,
            "source": "native_i2c",
        }
