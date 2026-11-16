"""Pruebas unitarias para el motor de enrutamiento marciano (A* ponderado)."""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.pathfinder import find_route
from app.terrain import Terrain


def _crear_dem_prueba(tmp_path: str) -> Terrain:
    """Crea una cuadrícula DEM sintética con una pendiente pronunciada, zona de arena y refugio."""
    elev = np.zeros((12, 12), dtype=np.int16)
    # Acantilado alto en la columna 5 (filas 0..8) para probar desvío y blindaje topográfico
    elev[0:9, 5] = 120
    # Depresión plana de arena suelta en (2, 2)
    elev[1:4, 1:4] = 10
    elev[2, 2] = 2

    np.savez_compressed(
        tmp_path,
        elevation=elev,
        west=137.5,
        north=-5.2,
        res_deg=0.00337,
        nodata=-32768,
        radius_m=3396190.0,
    )
    return Terrain(tmp_path)


class TestPathfinderMarciano(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dem_path = os.path.join(os.path.dirname(__file__), "_tmp_test_dem.npz")
        cls.terrain = _crear_dem_prueba(cls.dem_path)

    @classmethod
    def tearDownClass(cls):
        if os.path.exists(cls.dem_path):
            os.remove(cls.dem_path)

    def test_ruta_optima_rodea_acantilado(self):
        """Verifica que la ruta rodee el acantilado cuando hay soporte de rover."""
        res = find_route(self.terrain, [6, 2], [6, 8], rover_support=True, solar_storm=False)
        self.assertTrue(res["feasible"], res["status"])
        self.assertGreater(res["metrics"]["distance_m"], 0)
        self.assertGreater(res["metrics"]["o2_consumption_kg"], 0)
        self.assertGreater(res["metrics"]["radiation_dose_msv"], 0)
        # El acantilado ocupa las filas 0..8 en la columna 5; la ruta debe rodearlo por debajo.
        cols_en_fila_acantilado = [p["row"] for p in res["path"] if p["col"] == 5]
        self.assertTrue(all(r >= 9 for r in cols_en_fila_acantilado))

    def test_bloqueo_rover_por_pendiente_o_arena(self):
        """Verifica que el rover quede bloqueado si el destino está en pendiente > 15°."""
        res = find_route(self.terrain, [4, 2], [4, 5], rover_support=True, solar_storm=False)
        self.assertFalse(res["feasible"])
        self.assertIn("Blocked", res["status"])

    def test_tormenta_solar_redirige_a_refugio(self):
        """Verifica que solar_storm=True ignore el destino y busque el refugio natural más cercano."""
        res = find_route(self.terrain, [10, 1], [10, 10], rover_support=True, solar_storm=True)
        self.assertTrue(res["feasible"], res["status"])
        self.assertTrue(res["shelter_reached"])
        self.assertIn("Solar storm alert", res["status"])

    def test_entrada_malformada_no_lanza_excepcion(self):
        """Verifica que coordenadas no numéricas devuelvan feasible=False sin lanzar ValueError."""
        res = find_route(self.terrain, ["a", "b"], [-5.21, 137.51], rover_support=True, solar_storm=False)
        self.assertFalse(res["feasible"])
        self.assertIn("Invalid", res["status"])

        res_dict = find_route(self.terrain, {"lat": "x", "lon": 137.5}, [6, 8])
        self.assertFalse(res_dict["feasible"])
        self.assertIn("Invalid", res_dict["status"])


if __name__ == "__main__":
    unittest.main()
