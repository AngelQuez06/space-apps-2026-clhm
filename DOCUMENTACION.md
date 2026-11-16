# CLHM: planificador de rutas EVA en el cráter Gale, Marte

**NASA Space Apps Challenge 2026 · Ciudad de México**
Versión: 14 de noviembre de 2026

> CLHM es una herramienta de demostración y planificación. Sus rutas y métricas son estimaciones de un modelo. No está validada para navegación real ni para la seguridad de una tripulación.

## 1. Resumen

CLHM es un mapa web del cráter Gale y del monte Sharp (Marte) que funciona como una app de mapas de la Tierra. Puedes hacer zoom desde todo el cráter hasta cerca de 1 m por píxel, superponer capas del terreno (pendiente, relieve, térmica) y trazar una ruta entre dos puntos. El sistema calcula la distancia, el tiempo de recorrido, el oxígeno de una tripulación de dos personas y la dosis de radiación. Un modo de "tormenta solar" busca el camino más rápido a un refugio natural.

El sitio abre el mapa estilizado del planificador con sitios reales y tramos del modelo de terreno de `/api/network`; las curvas del fondo son decorativas. Los controles de relieve, riesgo y ciencia conservan el color cobre al seleccionarse. Las imágenes geográficas de NASA/USGS siguen disponibles en el selector. Los datos se cargan automáticamente y aparece «Retry data» si falla la red; se quitó el botón de conexión.

Las imágenes y elevaciones vienen de fuentes públicas de la NASA y del USGS. Las rutas, el oxígeno, el tiempo y la dosis son estimaciones del modelo, no datos validados para seguridad. No se necesitan claves de API.

| | Dirección |
| --- | --- |
| Sitio web (frontend) | https://www.clhm.cooking |
| API (backend) | https://api.clhm.study |
| Código | https://github.com/sauriopqno/Space-apps-2026 |

## 2. Características principales

| Característica | Qué hace |
| --- | --- |
| **Mapa con zoom** | Imágenes satelitales que se vuelven más nítidas al acercarte: unos 232 m/píxel en todo Marte, unos 6 m en el cráter Gale y hasta cerca de 1 m en la zona que recorrió Curiosity. |
| **Modos de mapa** | Satélite con color aproximado (grises como alternativa), relieve MOLA y térmico nocturno THEMIS. |
| **Capa de pendiente** | Colorea el terreno según lo empinado: verde (0–10°), amarillo (10–15°), naranja (15–20°, sin rover) y rojo (más de 20°, sin paso a pie). |
| **Capa de calidad del dato** | Muestra en azul dónde hay datos finos de terreno a 10 m. El resto usa datos gruesos de 200 m. |
| **Capa de radiación** | Tasa de dosis modelada en superficie, en mSv/día: la línea base de Curiosity RAD (0.364) × el factor de protección del terreno. Turquesa = protegido por paredes (0.237), amarillo = terreno abierto (0.364), rojo = cresta expuesta (0.418). Es un modelo, no una medición en cada punto. |
| **Capas en todos los modos** | Pendiente, Radiación y Calidad del dato se eligen con un solo selector (una a la vez; otro clic la oculta) en el mapa del planificador y en todos los mapas geográficos, con su leyenda. Los mapas geográficos usan tiles; el planificador usa una sola imagen para toda su área (`area.png`). |
| **Escala** | Visible en todos los modos. En los mapas geográficos sigue el zoom y la latitud (de 5 m a 100 km). |
| **Inspector de terreno** | Haz clic en un punto para ver su elevación, pendiente, clase de riesgo, dosis modelada y la fuente de datos usada. |
| **Planificador de rutas (todos los modos)** | Dos formas de ruta en cualquier mapa (planificador, satélite, relieve, térmico): **sitios de Gale** (menús o clic en un sitio) o **dos puntos libres** (un clic para A y otro para B; se calcula sola). Al elegir puntos, un clic sobre un sitio ajusta el punto a ese sitio. Los 15 sitios se dibujan en todos los modos, y al entrar a un mapa geográfico la vista se encuadra en la ruta activa. |
| **Detalles y perfil completos** | Para los dos tipos de ruta y en todos los modos: distancia, tiempo, O₂, dosis, riesgo, tramos, alternativas y perfil de elevación a lo largo del trazado A* real, con el tramo de mayor riesgo. |
| **Contexto de exposición humana** | En los detalles de ruta, una figura ilustrativa acompaña la dosis estimada, la mediana de dosis absorbida en silicio medida por Curiosity RAD (0.1227 mGy/día, 1 enero–11 noviembre de 2026) y el estándar NASA de menos de 600 mSv de dosis efectiva a lo largo de la carrera. Son magnitudes distintas: no se calcula un porcentaje del límite ni una dosis personal u orgánica. |
| **Modos de movilidad** | Rover (más estricto: pendiente máxima de 15°, evita arena suelta), a pie (máximo 20°) y refugio por tormenta. |
| **Modo tormenta solar** | Solo necesita el punto de inicio. Busca la ruta más rápida al refugio natural más cercano, con radiación 18 veces la normal. |
| **Métricas de ruta** | Distancia (km), tiempo (minutos), oxígeno (kg, dos tripulantes) y dosis de radiación (mSv). |
| **Recorrido guiado** | Divide la ruta en hasta 8 tramos. La vista de voz opcional elige automáticamente una voz inglesa del navegador, da la bienvenida y narra la información de la ruta y los tramos siguientes. |
| **Mapa del planificador (red real)** | El mapa estilizado carga 15 sitios de Gale y 23 tramos del modelo de terreno desde `GET /api/network`; si fallan los datos ofrece reintentar en lugar de mostrar una ruta ficticia. La vista geográfica NASA/USGS sigue disponible. |
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
- **Factor de radiación (de 0.65 a 1.15):** las paredes reducen la exposición hasta un 35%. Las crestas expuestas la aumentan un 15%. La fórmula exacta está en 4.9.
- **Refugio natural (`is_shelter`):** celdas transitables junto a paredes muy empinadas, con al menos 55 m de relieve. Cumplen cerca del 7.4% de las celdas.

### 4.5 Búsqueda de rutas: A* ponderado
El terreno se trata como una malla en la que cada celda se conecta con sus 8 vecinas. A* encuentra el camino de menor costo.

**Costo de cada paso (modo normal):**
`costo = distancia × (1 + 0.08 × pendiente de la celda + 0.12 × pendiente de subida + 0.6 × factor de radiación)`

Así, la ruta prefiere caminos cortos, planos y protegidos. No se puede entrar a celdas que pasan el límite de pendiente, ni a arena suelta con rover.

**Modo tormenta solar:** minimiza el tiempo y se detiene en el primer refugio que alcanza, una búsqueda tipo Dijkstra sin destino fijo.

**Rendimiento:** las rutas típicas tardan entre 0.05 y 0.6 s. Una ruta de 47 km tardó 0.58 s y una evacuación 0.03 s.

### 4.6 Red del planificador (sitios y tramos reales)
`backend/scripts/build_network.py` construye la red una sola vez y la guarda en `backend/data/network.json`, lo que tarda unos 6 s:
- **Sitios:** posiciones de Curiosity en soles conocidos (primera aproximación al boxwork en el sol 4570, zona principal de boxwork en el sol 4623, posición más reciente), objetivos científicos de HiRISE (centro de cada DTM oficial), puntos de Mars Trek, un hábitat modelado (el terreno firme más plano junto al primer punto del recorrido dentro del bloque) y dos refugios naturales modelados.
- **Tramos:** cada sitio se une con sus 3 sitios más cercanos. Cada unión es una ruta A* a pie, más una revisión para rover. Si no existe ruta, el par se descarta, como pasa con el cuadrante original.
- **Riesgo del tramo (0–100):** `100 × (0.50 × min(1, pendiente máx / 30°) + 0.35 × min(1, 4 × fracción sobre 15°) + 0.15 × min(1, 5 × fracción con arena))`, con la pendiente más fina disponible en cada punto del trazado.

### 4.7 Métricas de la ruta

| Métrica | Cómo se calcula |
| --- | --- |
| Velocidad | 1.4 m/s (rover) o 1.25 m/s (a pie), reducida por la pendiente, con un mínimo del 25% |
| Oxígeno | 0.11 kg/h para dos tripulantes, más 4% por cada grado de subida |
| Radiación | 0.364 mSv/día, medido por Curiosity RAD en 2026 (ver 4.8), × factor de radiación, × 18 durante una tormenta (escenario modelado) |

### 4.8 Radiación base real (Curiosity RAD)
`backend/scripts/fetch_rad.py` descarga la dosimetría de nivel 2 del detector de radiación de Curiosity (RAD) desde el SPDF de la NASA, un archivo por día, y guarda el resultado en `backend/data/rad_baseline.json` (66 KB):
1. **Dosis diaria:** para cada día promedia la columna "RTG Corrected Dose B", que es el detector de silicio sin la radiación del generador nuclear del propio Curiosity. Las observaciones se ponderan por su tiempo de medición y se excluyen las marcadas con problemas.
2. **Línea base:** la mediana de 315 días (del 1 de enero al 11 de noviembre de 2026, soles 4765 a 5071) es de 0.123 mGy/día.
3. **Tejido:** se convierte de silicio con la razón medida entre el detector equivalente a tejido y el de silicio (0.972), lo que da 0.119 mGy/día.
4. **Dosis equivalente:** se multiplica por el factor de calidad medio de 3.05 publicado por el equipo de RAD (Hassler et al., 2014, *Science*), lo que da **0.364 mSv/día**. El factor de calidad no viene en el archivo de nivel 2.

Los días variaron un 7.9%. El día más alto (6 de noviembre) fue 1.09 veces la mediana, así que en 2026 no se registró ninguna tormenta solar fuerte. La constante anterior (0.64 mSv/día) venía de 2012–2013, cerca del mínimo solar. En 2026 el Sol está cerca de su máximo, lo que reduce los rayos cósmicos que llegan a Marte.

### 4.9 Índice de radiación por lugar
Cada celda de 200 m de la malla del terreno recibe un **factor de radiación**, un número sin unidades en el que 1.0 significa terreno abierto y plano. El backend lo calcula una sola vez al arrancar (`Terrain.__init__` en `backend/app/terrain.py`) a partir del modelo de elevación HRSC+MOLA, mirando las 8 celdas alrededor de cada celda:

1. **Puntaje de pared:** `clip((pendiente de la vecina más empinada − 14°) / 14°, 0, 1)`. Vale 0 a 14° y llega a 1 a 28°.
2. **Puntaje de relieve:** `clip(altura de la vecina más alta sobre la celda / 45 m, 0, 1)`.
3. **Protección** (`cliff_shielding`): el mayor de los dos puntajes, de 0 a 1.
4. **Exposición de cresta:** +0.15 si la celda está más de 25 m por encima del promedio de sus vecinas; si no, 0.
5. **Factor:** `clip(1 − 0.35 × protección + exposición de cresta, 0.65, 1.15)`.

**Tasa de dosis en un lugar** = línea base de RAD (0.364 mSv/día, ver 4.8) × factor:

| Lugar | Factor | Tasa de dosis |
| --- | --- | --- |
| Al pie de una pared (≥ 28° al lado o ≥ 45 m de relieve) | 0.65 | 0.237 mSv/día |
| Terreno abierto y plano | 1.00 | 0.364 mSv/día |
| Cresta expuesta | 1.15 | 0.418 mSv/día |

Son los tres valores de la leyenda de la capa de Radiación. `GET /api/terrain/point` devuelve `radiation_factor` y `dose_rate_msv_day` para cualquier punto, y la capa de Radiación toma la misma malla para cada píxel.

**Del lugar a la ruta:** en cada paso de una ruta A*, la dosis es `horas del paso × (0.364 / 24) × factor de la celda a la que entra`, multiplicada por 18 durante una tormenta solar (escenario modelado). La dosis de la ruta es la suma de todos los pasos. Los tramos del planificador usan el mismo cálculo a pie (`foot.radiation_dose_msv` en `network.json`), y una ruta del planificador suma sus tramos.

El mismo factor entra en el costo de la ruta (`0.6 × factor`, ver 4.5) y define los refugios naturales (protección ≥ 0.95 y al menos 55 m de relieve, ver 4.4). Usa solo la malla de 200 m, no los parches de 10 m; ver la limitación en la sección 9.

## 5. Fuentes de datos

| Dato | Proveedor | Uso |
| --- | --- | --- |
| Imágenes Viking, CTX y HiRISE | NASA/JPL Mars Trek (WMTS) | Mapa satelital |
| Relieve sombreado MGS MOLA | NASA/JPL Mars Trek | Modo relieve |
| Infrarrojo nocturno THEMIS (~100 m) | NASA/JPL Mars Trek | Modo térmico (oscuro es material fino, claro es roca) |
| DEM combinado HRSC+MOLA, 200 m v2 | USGS Astrogeology | Pendiente y elevación base |
| 22 DTM de HiRISE, 1 m, reducidos a 10 m | Archivo PDS de HiRISE (Universidad de Arizona) | Pendiente y elevación finas |
| Dosimetría de nivel 2 de Curiosity RAD, 315 días de 2026 | SPDF de la NASA (`msl/rad/cdf/obs-l2`), investigador principal D. Hassler, SwRI | Radiación base real para la dosis de la ruta |
| Factor de calidad medio de 3.05 | Hassler et al. (2014), *Science* 343 | Paso de dosis absorbida a dosis equivalente |
| Recorrido de Curiosity, 1,389 puntos (sol 3 a 5073) | NASA MMGIS (`MSL_waypoints.json`) | Sitios reales del planificador (zona boxwork, posición más reciente) |
| Descripciones de objetivos de HiRISE | Índice de DTM del PDS de HiRISE | Nombres de los sitios científicos |

Todas son públicas y gratuitas. Las imágenes se descargan al pedirlas y se guardan en caché. Los datos de elevación se procesaron una vez y se guardaron junto al código (unos 19 MB).

## 6. API (endpoints del backend)

| Endpoint | Devuelve |
| --- | --- |
| `GET /api/health` | Estado del servicio |
| `GET /api/zone` | Nombre de la zona, centro (5.4°S, 137.8°E), área de interés (todo el bloque) y el cuadrante original |
| `GET /api/layers` | Lista de capas del mapa con sus plantillas de URL |
| `GET /api/tiles/{capa}/{z}/{x}/{y}.{ext}` | Imagen de una tile del mapa |
| `GET /api/terrain/slope/{z}/{x}/{y}.png` | Tile de la capa de pendiente |
| `GET /api/terrain/quality/{z}/{x}/{y}.png` | Tile de la capa de calidad del dato |
| `GET /api/terrain/radiation/{z}/{x}/{y}.png` | Tile de la capa de radiación modelada |
| `GET /api/terrain/{slope\|radiation\|quality}/area.png?bbox=o,s,e,n&width=&height=` | Una imagen de capa para una caja lat/lon (máx. 1200 px y 10°), usada por el planificador |
| `GET /api/terrain/point?lat=&lon=` | Elevación, pendiente, clase, resolución, fuente, `radiation_factor` y `dose_rate_msv_day` en un punto |
| `GET /api/terrain/info` | Cobertura del terreno y lista de parches finos |
| `POST /api/route` | Trazado y métricas de la ruta |
| `GET /api/network` | Red real del planificador: sitios, tramos A* y una clave `demo` con la misma forma que los datos de demostración anteriores |
| `GET /api/radiation` | Radiación base real de RAD, método y serie diaria (`?days=0` omite la serie) |

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
- **Almacenamiento de datos:** no hay base de datos, porque el producto no tiene cuentas de usuario ni datos guardados (el diario de radiación por usuario de la sección 10 cambiaría esto). Las tiles se guardan en caché en la memoria temporal de la instancia.

## 8. Ventajas

- **Datos reales sin costo:** todo viene de NASA, JPL y USGS, sin claves de API y sin servicios de pago aparte del alojamiento.
- **Detalle donde existe:** las imágenes llegan a cerca de 1 m/px y el terreno a 10 m en las zonas con modelos de HiRISE. El resto sigue cubierto a 200 m.
- **Honestidad sobre la incertidumbre:** cada punto indica su resolución y su fuente, y la capa de calidad muestra dónde el dato es fino o grueso.
- **Rapidez:** las rutas tardan menos de un segundo, y el mapa solo carga las tiles visibles en pantalla.
- **Pensado para la misión:** los límites de pendiente (15° rover, 20° a pie), el oxígeno de dos tripulantes, la radiación y los refugios por tormenta vienen de la especificación del reto.
- **Simple y portátil:** un frontend estático y un backend pequeño, que se despliegan en minutos, con HTTPS, CORS y límites de peticiones.

## 9. Desventajas y limitaciones

- **El cuadrante original de 5 × 5 km no tiene rutas posibles.** Está en la ladera norte del monte Sharp, con pendiente media de 28°, y solo el 2.3% de sus celdas es transitable para un rover. Como el área de interés ahora es todo el bloque, queda solo como referencia.
- **Bradbury Landing queda fuera del bloque.** El lugar de aterrizaje de Curiosity está unos 0.8 km al norte del borde, así que la red del planificador usa un hábitat modelado en el primer punto del recorrido que sí cae dentro.
- **Riesgo alto en la mayoría de los tramos reales.** Con pendientes de 10 m, casi todos los tramos dan un riesgo de 60 o más, así que "evitar riesgo alto" a menudo no encuentra ruta. Refleja lo empinado de las faldas del monte Sharp.
- **Las rutas solo usan la malla de 200 m.** Todavía no usan los parches de 10 m, así que podrían cruzar terreno empinado que el dato fino bloquearía.
- **Terreno grueso en casi toda el área:** a 200 m las pendientes se subestiman y los obstáculos pequeños (rocas, cráteres chicos) no se ven.
- **Las métricas son modelos simples:** la velocidad y el oxígeno usan constantes fijas, no telemetría real de la tripulación ni del rover.
- **La radiación es medida, pero simplificada:** la línea base es una mediana de 2026 de Curiosity, medida en un solo punto (que se mueve) y aplicada a todo el bloque. El factor de calidad viene de la literatura, el factor de tormenta solar (× 18) es un escenario modelado, y el valor no es clima espacial en vivo. Hay que reconstruirlo con `fetch_rad.py` para mantenerlo al día.
- **La capa de radiación tiende a "protegido".** El factor del terreno trata las celdas empinadas de 200 m como paredes: el 25% del bloque queda en el valor más bajo (≤ 0.66), el 72% entre 0.66 y 0.99, el 2.6% es terreno abierto y ninguna celda llega a "cresta expuesta". Un modelo de cielo visible (cuánto cielo ve cada punto) sería más realista.
- **Peligros aproximados:** la arena suelta y los refugios se estiman solo con la elevación. THEMIS es una guía visual, no inercia térmica calibrada.
- **Color aproximado:** se tiñe a partir de una fuente de baja resolución.
- **Dependencia de Mars Trek:** las tiles nuevas se descargan de la NASA, y la caché se pierde cuando una instancia se reinicia. Mucho tráfico o una caída de Mars Trek harían lento el mapa.
- **Mapa del planificador:** las coordenadas de los sitios y las métricas de los tramos proceden de fuentes de terreno NASA/USGS; el fondo dibujado es decorativo. El hábitat y los refugios son propuestas modeladas; las estimaciones no están validadas para navegación o seguridad.
- **Voz en Linux:** la vista de voz necesita la síntesis de voz del sistema operativo. En Firefox para Linux, eso implica instalar `speech-dispatcher` y `espeak-ng`.
- **Escala:** los límites de peticiones son por instancia, y la búsqueda de rutas usa CPU en Python puro. Basta para una demostración, pero haría falta trabajo para cientos de usuarios.

## 10. Áreas de oportunidad

| Prioridad | Mejora | Beneficio |
| --- | --- | --- |
| Alta | Usar los parches de 10 m en la búsqueda de rutas (primero una ruta gruesa, luego refinarla en un corredor) | Rutas más seguras y realistas |
| Alta | Ampliar el bloque cerca de 1 km al norte (e idealmente a todo el cráter) para incluir Bradbury Landing y el borde completo | Usar el lugar de aterrizaje en las rutas |
| Media | Calcular el factor de calidad con el espectro LET de RAD y actualizar la línea base de RAD automáticamente | Dosis equivalente totalmente medida y siempre actual |
| Media | Diario de radiación acumulada por usuario (detalle abajo) | Cada tripulante ve su dosis acumulada frente a los límites de la misión antes de aceptar una nueva EVA |
| Media | Agregar la composición de rocas APXS como puntos científicos (ya identificada en `Resources`) | Objetivos reales para tomar muestras |
| Media | Agregar fotos del rover (Mastcam/Navcam) en los puntos de ruta | Vista en primera persona, como pide la especificación |
| Media | Usar los minerales de CRISM y la inercia térmica de THEMIS en el costo de la ruta | Mejor detección de arena y de objetivos boxwork |
| Media | Pregenerar las tiles en un bucket de Cloud Storage con CDN | Más rapidez, independencia de Mars Trek y capacidad para más usuarios |
| Baja | Poner un tope a la caché de tiles | Evita llenar la memoria |
| Baja | Pasar la búsqueda de rutas a código compilado (SciPy o Numba) | Más usuarios a la vez |
| Baja | Detectar rocas y cráteres pequeños en las imágenes de HiRISE | Peligros que la elevación no muestra |

**Diario de radiación acumulada por usuario (oportunidad futura).** Hoy cada ruta reporta solo su propia dosis. El diario llevaría un registro por persona:
- **Entradas:** una por EVA, con fecha o sol, ruta, dosis planeada (`radiation_dose_msv` de la ruta) y, después de la caminata, la dosis realizada. El tiempo dentro del hábitat se sumaría con una tasa protegida.
- **Totales:** diario, de 30 días, anual y de la misión. Se compararían con los límites que fije la misión; como referencia, el límite de carrera de la NASA es de 600 mSv (NASA-STD-3001).
- **En el planificador:** antes de aceptar una EVA, mostrar "esta ruta suma X mSv; tu total de 30 días quedaría en Y". Avisar cuando una ruta pasaría un límite, y registrar los días de tormenta por separado.
- **Implementación:** una primera versión puede guardar el diario en el navegador (`localStorage`), sin cuentas. Un diario compartido de la tripulación necesita cuentas de usuario y una base de datos pequeña. Son datos personales de salud, así que requieren control de acceso, cifrado y consentimiento.

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
