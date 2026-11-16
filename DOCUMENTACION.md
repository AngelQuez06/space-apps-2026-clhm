# CLHM: planificador de rutas EVA en el cráter Gale, Marte

**NASA Space Apps Challenge 2026 · Ciudad de México**
Versión: 14 de noviembre de 2026

> CLHM es una herramienta de demostración y planificación. Sus rutas y métricas son estimaciones de un modelo. No está validada para navegación real ni para la seguridad de una tripulación.

## 1. Resumen

CLHM es un mapa web del cráter Gale y del monte Sharp (Marte) que funciona como una app de mapas de la Tierra. Puedes hacer zoom desde todo el cráter hasta cerca de 1 m por píxel, superponer capas del terreno (pendiente, relieve, térmica) y trazar una ruta entre dos puntos. El sistema calcula la distancia, el tiempo de recorrido, el oxígeno de una tripulación de dos personas y la dosis de radiación. Un modo de "tormenta solar" busca el camino más rápido a un refugio natural.

Todo lo que se muestra viene de datos públicos de la NASA y del USGS. No se necesitan claves de API.

| | Dirección |
| --- | --- |
| Sitio web (frontend) | https://www.clhm.cooking |
| API (backend) | https://api.clhm.study |
| Código | https://github.com/sauriopqno/Space-apps-2026 |

## 2. Características principales

| Característica | Qué hace |
| --- | --- |
| **Mapa con zoom** | Imágenes satelitales que se vuelven más nítidas al acercarte: unos 232 m/píxel en todo Marte, unos 6 m en el cráter Gale y hasta cerca de 1 m en la zona que recorrió Curiosity. |
| **Modos de mapa** | Satélite con color aproximado, satélite en grises, relieve MOLA y térmico nocturno THEMIS. |
| **Capa de pendiente** | Colorea el terreno según lo empinado: verde (0–10°), amarillo (10–15°), naranja (15–20°, sin rover) y rojo (más de 20°, sin paso a pie). |
| **Capa de calidad del dato** | Muestra en azul dónde hay datos finos de terreno a 10 m. El resto usa datos gruesos de 200 m. |
| **Inspector de terreno** | Haz clic en un punto para ver su elevación, pendiente, clase de riesgo y la fuente de datos usada. |
| **Planificador de rutas** | Un clic para el inicio (A) y otro para el destino (B). La ruta se calcula sola. Se recalcula si mueves un punto o cambias el modo. |
| **Modos de movilidad** | Rover (más estricto: pendiente máxima de 15°, evita arena suelta), a pie (máximo 20°) y refugio por tormenta. |
| **Modo tormenta solar** | Solo necesita el punto de inicio. Busca la ruta más rápida al refugio natural más cercano, con radiación 18 veces la normal. |
| **Métricas de ruta** | Distancia (km), tiempo (minutos), oxígeno (kg, dos tripulantes) y dosis de radiación (mSv). |
| **Recorrido guiado** | Divide la ruta en hasta 8 tramos y los presenta uno por uno. Una vista de voz opcional los narra en voz alta. |
| **Modo demo** | Un mapa ilustrativo con sitios ficticios. Funciona sin backend y está marcado claramente como simulado. |
| **Exportar** | Guarda el plan como archivo JSON. |

## 3. Cómo funciona

```
 Navegador del usuario
      │
      ▼
 Frontend (HTML/CSS/JS estático) ── alojado en Vercel ── www.clhm.cooking
      │   Vercel reenvía /api/* al backend
      ▼
 Backend (Python + Flask) ── Google Cloud Run ── api.clhm.study
      │   • Sirve las tiles del mapa (con caché)
      │   • Calcula pendientes y datos de terreno
      │   • Calcula rutas (algoritmo A*)
      ▼
 Fuentes de datos públicas
      • JPL Mars Trek (imágenes, descargadas al pedirlas)
      • USGS y HiRISE (elevación, procesada antes y guardada con el código)
```

- **Frontend:** HTML, CSS y JavaScript sin frameworks. Dibuja su propio mapa de tiles, así que no depende de Google Maps ni de Leaflet.
- **Backend:** Flask, que corre con gunicorn dentro de un contenedor Docker.
- **Malla del mapa:** coordenadas geográficas (EPSG:4326), con 2 × 1 tiles de 256 px en el zoom 0, el mismo esquema que usa Mars Trek.

## 4. Algoritmos

### 4.1 Nivel de detalle (más nítido al acercarse)
La capa satelital apila tres fuentes de imagen y dibuja encima la más fina disponible:

| Fuente | Resolución | Cobertura | Zoom nativo máximo |
| --- | --- | --- | --- |
| Viking MDIM 2.1 (color) | 232 m/px | Todo Marte | 7 |
| MRO CTX, mosaico de Gale | ~6 m/px | Cráter Gale | 12 |
| MRO HiRISE, mosaico de Curiosity | ~0.25–1 m/px | Recorrido de Curiosity | 16 |

Después del zoom máximo de cada fuente, el backend amplía su imagen más fina hasta 3 niveles más, hasta el zoom 19.

### 4.2 Color aproximado
Las imágenes de CTX y HiRISE son en blanco y negro. Para darles color, el backend toma el brillo de CTX/HiRISE y el color de Viking (técnica llamada *pansharpening*). El brillo se multiplica por 0.76 para que ambos coincidan, un factor medido en 54 tiles de Gale. **El color es aproximado, no una medición del color real de la roca.**

### 4.3 Pendiente
Para cada celda de una malla de elevación, la pendiente es el ángulo del mayor cambio de altura, calculado con las celdas vecinas. Toma en cuenta que la distancia este-oeste de un grado se acorta al alejarse del ecuador.

**Dos niveles de detalle:**
- **Base:** malla de 200 m/px (USGS HRSC+MOLA) que cubre de 137.20 a 138.40°E y de 6.20 a 4.60°S, unos 120 × 180 km.
- **Fina:** 22 modelos de elevación de HiRISE reducidos de 1 m a 10 m/px. Cubren el 15.2% de esa ventana. Donde existen, sustituyen el valor de la base.

**Por qué importa:** en los mismos lugares, los datos de 10 m muestran el 13.7% del terreno por encima de 20°, contra el 2.5% con los de 200 m. La malla gruesa suaviza los acantilados y subestima lo empinado unas cinco veces.

### 4.4 Capas de peligro derivadas (para las rutas)
- **Arena suelta (`sand_ripple`):** celdas muy planas (menos de 1.8°) al menos 2 m por debajo de sus vecinas, donde suele acumularse arena traída por el viento. El rover las evita. Es una estimación basada solo en la elevación.
- **Protección por paredes (`cliff_shielding`, de 0 a 1):** qué tan cerca está una celda de paredes empinadas o de mucho relieve.
- **Factor de radiación (de 0.65 a 1.15):** las paredes reducen la exposición hasta un 35%. Las crestas expuestas la aumentan un 15%.
- **Refugio natural (`is_shelter`):** celdas transitables junto a paredes muy empinadas, con al menos 55 m de relieve. Cumplen cerca del 7.4% de las celdas.

### 4.5 Búsqueda de rutas: A* ponderado
El terreno se trata como una malla en la que cada celda se conecta con sus 8 vecinas. A* encuentra el camino de menor costo.

**Costo de cada paso (modo normal):**
`costo = distancia × (1 + 0.08 × pendiente de la celda + 0.12 × pendiente de subida + 0.6 × factor de radiación)`

Así, la ruta prefiere caminos cortos, planos y protegidos. No se puede entrar a celdas que pasan el límite de pendiente, ni a arena suelta con rover.

**Modo tormenta solar:** minimiza el tiempo y se detiene en el primer refugio que alcanza, una búsqueda tipo Dijkstra sin destino fijo.

**Rendimiento:** las rutas típicas tardan entre 0.05 y 0.6 s. Una ruta de 47 km tardó 0.58 s y una evacuación 0.03 s.

### 4.6 Métricas de la ruta

| Métrica | Cómo se calcula |
| --- | --- |
| Velocidad | 1.4 m/s (rover) o 1.25 m/s (a pie), reducida por la pendiente, con un mínimo del 25% |
| Oxígeno | 0.11 kg/h para dos tripulantes, más 4% por cada grado de subida |
| Radiación | 0.64 mSv/día (promedio de superficie de Curiosity RAD), × factor de radiación, × 18 durante una tormenta |

## 5. Fuentes de datos

| Dato | Proveedor | Uso |
| --- | --- | --- |
| Imágenes Viking, CTX y HiRISE | NASA/JPL Mars Trek (WMTS) | Mapa satelital |
| Relieve sombreado MGS MOLA | NASA/JPL Mars Trek | Modo relieve |
| Infrarrojo nocturno THEMIS (~100 m) | NASA/JPL Mars Trek | Modo térmico (oscuro es material fino, claro es roca) |
| DEM combinado HRSC+MOLA, 200 m v2 | USGS Astrogeology | Pendiente y elevación base |
| 22 DTM de HiRISE, 1 m, reducidos a 10 m | Archivo PDS de HiRISE (Universidad de Arizona) | Pendiente y elevación finas |
| Radiación base de 0.64 mSv/día | Valor publicado de Curiosity RAD | Dosis de la ruta |

Todas son públicas y gratuitas. Las imágenes se descargan al pedirlas y se guardan en caché. Los datos de elevación se procesaron una vez y se guardaron junto al código (unos 19 MB).

## 6. API (endpoints del backend)

| Endpoint | Devuelve |
| --- | --- |
| `GET /api/health` | Estado del servicio |
| `GET /api/zone` | Nombre y centro de la zona (5.4°S, 137.8°E) |
| `GET /api/layers` | Lista de capas del mapa con sus plantillas de URL |
| `GET /api/tiles/{capa}/{z}/{x}/{y}.{ext}` | Imagen de una tile del mapa |
| `GET /api/terrain/slope/{z}/{x}/{y}.png` | Tile de la capa de pendiente |
| `GET /api/terrain/quality/{z}/{x}/{y}.png` | Tile de la capa de calidad del dato |
| `GET /api/terrain/point?lat=&lon=` | Elevación, pendiente, clase, resolución y fuente en un punto |
| `GET /api/terrain/info` | Cobertura del terreno y lista de parches finos |
| `POST /api/route` | Trazado y métricas de la ruta |

Ejemplo de petición de ruta:
```json
{ "start": {"lat": -5.927, "lon": 137.40}, "end": {"lat": -5.927, "lon": 137.749},
  "rover_support": true, "solar_storm": false }
```

## 7. Infraestructura y seguridad

- **Alojamiento:** Google Cloud Run (us-central1, 1 GiB de memoria, máximo 3 instancias) con HTTPS y certificado administrado por Google. El frontend corre en Vercel, que reenvía `/api/*` al backend.
- **Dominios:** `clhm.study` (del patrocinio de GoDaddy) para la API y `clhm.cooking` para el sitio web.
- **CORS:** la API solo acepta peticiones de navegador desde `clhm.study`. El sitio usa el reenvío de Vercel, así que no necesita su propia excepción.
- **Límites por IP:** 120 peticiones por minuto en general, 1200 para tiles y 10 para rutas. Al pasarse responde con el error 429.
- **Otras protecciones:** cabeceras de seguridad y HSTS, el contenedor corre con un usuario sin privilegios, solo se permiten GET y POST, las entradas se validan y no hay secretos en el código.
- **Almacenamiento de datos:** no hay base de datos, porque el producto no tiene cuentas de usuario ni datos guardados. Las tiles se guardan en caché en la memoria temporal de la instancia.

## 8. Ventajas

- **Datos reales sin costo:** todo viene de NASA, JPL y USGS, sin claves de API y sin servicios de pago aparte del alojamiento.
- **Detalle donde existe:** las imágenes llegan a cerca de 1 m/px y el terreno a 10 m en las zonas con modelos de HiRISE. El resto sigue cubierto a 200 m.
- **Honestidad sobre la incertidumbre:** cada punto indica su resolución y su fuente, y la capa de calidad muestra dónde el dato es fino o grueso.
- **Rapidez:** las rutas tardan menos de un segundo, y el mapa solo carga las tiles visibles en pantalla.
- **Pensado para la misión:** los límites de pendiente (15° rover, 20° a pie), el oxígeno de dos tripulantes, la radiación y los refugios por tormenta vienen de la especificación del reto.
- **Simple y portátil:** un frontend estático y un backend pequeño, que se despliegan en minutos, con HTTPS, CORS y límites de peticiones.

## 9. Desventajas y limitaciones

- **El cuadrante de 5 × 5 km no tiene rutas posibles.** Está en la ladera norte del monte Sharp, con pendiente media de 28°. Solo el 2.3% de sus celdas es transitable para un rover, y no tiene datos de 10 m. Las rutas sí funcionan en el piso del cráter.
- **Las rutas solo usan la malla de 200 m.** Todavía no usan los parches de 10 m, así que podrían cruzar terreno empinado que el dato fino bloquearía.
- **Terreno grueso en casi toda el área:** a 200 m las pendientes se subestiman y los obstáculos pequeños (rocas, cráteres chicos) no se ven.
- **Las métricas son modelos simples:** la velocidad, el oxígeno y la radiación usan constantes fijas, no telemetría real de la tripulación ni del rover. La radiación es un promedio fijo, no clima espacial en vivo.
- **Peligros aproximados:** la arena suelta y los refugios se estiman solo con la elevación. THEMIS es una guía visual, no inercia térmica calibrada.
- **Color aproximado:** se tiñe a partir de una fuente de baja resolución.
- **Dependencia de Mars Trek:** las tiles nuevas se descargan de la NASA, y la caché se pierde cuando una instancia se reinicia. Mucho tráfico o una caída de Mars Trek harían lento el mapa.
- **El mapa demo es ficticio:** sus sitios y su red de rutas son ilustrativos.
- **Voz en Linux:** la vista de voz necesita la síntesis de voz del sistema operativo. En Firefox para Linux, eso implica instalar `speech-dispatcher` y `espeak-ng`.
- **Escala:** los límites de peticiones son por instancia, y la búsqueda de rutas usa CPU en Python puro. Basta para una demostración, pero haría falta trabajo para cientos de usuarios.

## 10. Áreas de oportunidad

| Prioridad | Mejora | Beneficio |
| --- | --- | --- |
| Alta | Usar los parches de 10 m en la búsqueda de rutas (primero una ruta gruesa, luego refinarla en un corredor) | Rutas más seguras y realistas |
| Alta | Decidir o mover el cuadrante de misión a una zona transitable (por ejemplo, el piso del cráter cerca del recorrido de Curiosity) | Rutas que funcionen en la zona de misión |
| Media | Cargar datos reales de dosis de Curiosity RAD (ya identificados en `Resources`) | Radiación real en lugar de una constante |
| Media | Agregar la composición de rocas APXS como puntos científicos (ya identificada en `Resources`) | Objetivos reales para tomar muestras |
| Media | Agregar fotos del rover (Mastcam/Navcam) en los puntos de ruta | Vista en primera persona, como pide la especificación |
| Media | Usar los minerales de CRISM y la inercia térmica de THEMIS en el costo de la ruta | Mejor detección de arena y de objetivos boxwork |
| Media | Pregenerar las tiles en un bucket de Cloud Storage con CDN | Más rapidez, independencia de Mars Trek y capacidad para más usuarios |
| Baja | Poner un tope a la caché de tiles | Evita llenar la memoria |
| Baja | Pasar la búsqueda de rutas a código compilado (SciPy o Numba) | Más usuarios a la vez |
| Baja | Detectar rocas y cráteres pequeños en las imágenes de HiRISE | Peligros que la elevación no muestra |

## 11. Ejecutarlo localmente (resumen)

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # deja CORS_ORIGINS=* solo para uso local
.venv/bin/python run.py       # http://127.0.0.1:5000

# Frontend (en otra terminal)
python3 -m http.server 8000 --directory frontend
# abre http://127.0.0.1:8000/index.html?api=http://127.0.0.1:5000
```

Los pasos de despliegue están en `backend/DEPLOY.md`. Los scripts de datos son `backend/scripts/fetch_dem.py` y `backend/scripts/fetch_dtm.py`.

## 12. Equipo

- Backend, datos y despliegue: [AI - Imanol] con Imanol
- Motor de rutas (A*): [AI - Angel]
- Frontend: [AI - setzedich]
- Investigación de datos: miembros del equipo (ver `Resources/General.txt`)
