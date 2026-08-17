"""Home Assistant coordinator for native Atlas I2C probes."""

from __future__ import annotations

from datetime import timedelta
import asyncio
import logging
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from ..const import DOMAIN
from .atlas_ezo import DEFAULT_ADDRESSES, AtlasDevice, AtlasEzoBus
from .motor_hat import MotorHatInventory

_LOGGER = logging.getLogger(__name__)


class AtlasI2CCoordinator(DataUpdateCoordinator[dict[str, dict]]):
    """Poll all discovered Atlas circuits sequentially on one shared bus."""

    def __init__(self, hass: HomeAssistant, bus_number: int = 1, hardware=None) -> None:
        super().__init__(
            hass,
            logger=_LOGGER,
            name=f"{DOMAIN} Atlas I2C",
            update_interval=timedelta(
                seconds=max(10, min(300, int((hardware or {}).get("poll_interval", 30))))
            ),
        )
        self.bus_number = bus_number
        self.device_path = Path(f"/dev/i2c-{bus_number}")
        self.devices: list[AtlasDevice] = []
        self.hardware = hardware or {}
        self.assignments = {
            int(item["address"]): item
            for item in self.hardware.get("device_assignments", [])
            if "address" in item
        }
        self._bus_lock = asyncio.Lock()
        self.diagnostic: dict[str, object] = {
            "available": False,
            "path": str(self.device_path),
            "error": None,
            "devices": [],
            "motor_hats": [],
            "discovered_devices": [],
        }

    async def async_initialize(self) -> bool:
        """Discover hardware without failing the rest of the integration."""
        if not self.device_path.exists():
            self.diagnostic["error"] = "I2C device path is not available"
            return False
        try:
            self.devices, motor_hats, discovered = await self.hass.async_add_executor_job(self._discover)
        except (OSError, ImportError) as err:
            self.diagnostic["error"] = f"{type(err).__name__}: {err}"
            return False
        self.diagnostic.update(
            {
                "available": True,
                "error": None,
                "devices": [
                    {
                        "address": f"0x{device.address:02x}",
                        "type": device.device_type,
                        "firmware": device.firmware,
                    }
                    for device in self.devices
                ],
                "motor_hats": motor_hats,
                "discovered_devices": discovered,
            }
        )
        return bool(self.devices)

    def _discover(self):
        atlas_drivers = {"atlas_do", "atlas_ph", "atlas_ec", "atlas_rtd"}
        atlas_assignments = {
            address: item for address, item in self.assignments.items()
            if item.get("driver") in atlas_drivers
        }
        addresses = set(DEFAULT_ADDRESSES)
        addresses.update(atlas_assignments)
        bus = AtlasEzoBus(self.bus_number)
        try:
            atlas_candidates = bus.discover(sorted(addresses))
        finally:
            bus.close()
        devices = [
            device for device in atlas_candidates if device.address in atlas_assignments
        ]
        inventory = MotorHatInventory(self.bus_number)
        try:
            hats = []
            for hat in inventory.discover(range(0x40, 0x60)):
                assignment = self.assignments.get(hat.address, {})
                hats.append({
                    "address": f"0x{hat.address:02x}",
                    "mode1": f"0x{hat.mode1:02x}",
                    "prescale": f"0x{hat.prescale:02x}",
                    "chip": "PCA9685",
                    "driver": assignment.get("driver"),
                    "name": assignment.get("name"),
                    "model": "Waveshare Motor Driver HAT" if assignment.get("driver") == "waveshare_motor_hat" else None,
                    "channels": hat.channels if assignment.get("driver") == "waveshare_motor_hat" else [],
                    "outputs_enabled": False,
                })
        finally:
            inventory.close()
        discovered = [
            {
                "address": f"0x{device.address:02x}",
                "chip": f"Atlas EZO {device.device_type}",
                "suggested_driver": f"atlas_{device.device_type.lower()}",
                "firmware": device.firmware,
            }
            for device in atlas_candidates
        ] + [
            {
                "address": hat["address"],
                "chip": "PCA9685",
                "suggested_driver": "waveshare_motor_hat",
                "firmware": None,
            }
            for hat in hats
        ]
        return devices, hats, discovered

    def _read_all(self) -> dict[str, dict]:
        bus = AtlasEzoBus(self.bus_number)
        result: dict[str, dict] = {}
        try:
            for device in self.devices:
                values = bus.read_measurement(device)
                result[device.key] = {
                    "address": device.address,
                    "device_type": device.device_type,
                    "firmware": device.firmware,
                    "values": values,
                }
        finally:
            bus.close()
        return result

    async def _async_update_data(self) -> dict[str, dict]:
        try:
            async with self._bus_lock:
                return await self.hass.async_add_executor_job(self._read_all)
        except (OSError, ValueError, RuntimeError) as err:
            raise UpdateFailed(f"Atlas I2C read failed: {err}") from err

    def _device_at(self, address: int) -> AtlasDevice:
        device = next((item for item in self.devices if item.address == address), None)
        if device is None:
            raise ValueError(f"No Atlas circuit discovered at 0x{address:02x}")
        return device

    async def async_calibration_status(self, address: int) -> str:
        """Read calibration status while serializing access to the bus."""
        device = self._device_at(address)
        async with self._bus_lock:
            return await self.hass.async_add_executor_job(
                self._calibration_status, device
            )

    def _calibration_status(self, device: AtlasDevice) -> str:
        bus = AtlasEzoBus(self.bus_number)
        try:
            return bus.calibration_status(device)
        finally:
            bus.close()

    async def async_calibrate(self, address: int, operation: str, value=None) -> str:
        """Execute one validated calibration while polling is locked."""
        device = self._device_at(address)
        async with self._bus_lock:
            result = await self.hass.async_add_executor_job(
                self._calibrate, device, operation, value
            )
        await self.async_request_refresh()
        return result

    def _calibrate(self, device: AtlasDevice, operation: str, value=None) -> str:
        bus = AtlasEzoBus(self.bus_number)
        try:
            return bus.calibrate(device, operation, value)
        finally:
            bus.close()
