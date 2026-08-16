"""Home Assistant coordinator for native Atlas I2C probes."""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from ..const import DOMAIN
from .atlas_ezo import AtlasDevice, AtlasEzoBus

_LOGGER = logging.getLogger(__name__)


class AtlasI2CCoordinator(DataUpdateCoordinator[dict[str, dict]]):
    """Poll all discovered Atlas circuits sequentially on one shared bus."""

    def __init__(self, hass: HomeAssistant, bus_number: int = 1) -> None:
        super().__init__(
            hass,
            logger=_LOGGER,
            name=f"{DOMAIN} Atlas I2C",
            update_interval=timedelta(seconds=30),
        )
        self.bus_number = bus_number
        self.device_path = Path(f"/dev/i2c-{bus_number}")
        self.devices: list[AtlasDevice] = []
        self.diagnostic: dict[str, object] = {
            "available": False,
            "path": str(self.device_path),
            "error": None,
            "devices": [],
        }

    async def async_initialize(self) -> bool:
        """Discover hardware without failing the rest of the integration."""
        if not self.device_path.exists():
            self.diagnostic["error"] = "I2C device path is not available"
            return False
        try:
            self.devices = await self.hass.async_add_executor_job(self._discover)
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
            }
        )
        return bool(self.devices)

    def _discover(self) -> list[AtlasDevice]:
        bus = AtlasEzoBus(self.bus_number)
        try:
            return bus.discover()
        finally:
            bus.close()

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
            return await self.hass.async_add_executor_job(self._read_all)
        except (OSError, ValueError, RuntimeError) as err:
            raise UpdateFailed(f"Atlas I2C read failed: {err}") from err
