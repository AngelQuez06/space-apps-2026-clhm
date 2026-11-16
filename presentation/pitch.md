# Pitch CLHM: guion para la presentación

**Duración:** unos 4 min 30 s (≈ 600 palabras, a ritmo tranquilo).
**Oradores:** tres voces. **A** abre y cierra, **B** muestra la app y **C** habla de datos y tecnología. Si presentan dos personas, A también toma las líneas de C. Si presenta una sola, quita las marcas de orador y el texto se lee igual.

**Principio:** cada diapositiva tiene una sola idea y una cifra que la sostiene. Las ventajas van primero. Los límites se presentan como "lo que sigue". La palabra fuerte de cada línea está en **negritas**.

Los números de sección coinciden con las diapositivas de `index.html` (`index.html#8` abre la 8).

---

### 01 · Portada (0:00 – 0:20)
**A:** Imaginen que son las primeras personas en pisar el Monte Sharp, en el cráter Gale. Tienen oxígeno para unas horas, un traje que pesa y un terreno que nadie ha caminado. ¿Por dónde empiezan?
Somos **CLHM**, y construimos la respuesta: un planificador de caminatas en Marte, **con datos reales de la NASA**.

### 02 · El reto (0:20 – 0:45)
**A:** En Marte, cada paso cuesta tres cosas: oxígeno, tiempo y radiación. La atmósfera tiene **menos del 1 %** de la presión de la Tierra y no hay campo magnético que proteja a la tripulación. A esto se suman pendientes que frenan al rover y arena que cansa a pie.
Planear una caminata ahí no puede depender de la intuición.

### 03 · La solución (0:45 – 1:05)
**B:** CLHM funciona como un navegador de la Tierra, pero para una caminata en Marte. Eliges un destino científico y CLHM te da **la ruta, su costo y su riesgo**.
Empezamos con **15 sitios reales**, tomados de las misiones Curiosity y HiRISE, conectados por **23 rutas** ya calculadas.

### 04 · Mapas de la NASA (1:05 – 1:20)
**B:** Puedes ver el cráter completo y acercarte hasta distinguir rocas. Las imágenes de Viking, CTX y HiRISE ganan detalle conforme haces zoom: pasan de 232 metros a cerca de **1 metro por píxel**. Son **232 veces** más detalle.

### 05 · Pendiente (1:20 – 1:40)
**B:** Esta capa traduce el relieve a algo que cualquiera entiende: **el verde se camina y el rojo no**. Aplicamos los límites de la misión en cada celda del mapa: 15 grados para el rover y 20 a pie.
Donde hay modelos de terreno de HiRISE, el detalle llega a **10 metros**.

### 06 · Radiación (1:40 – 2:00)
**C:** La radiación no la inventamos: la medimos. Usamos **315 días** de lecturas del detector RAD de Curiosity en 2026, con una dosis base de **0.364 milisieverts al día**. Encima calculamos cuánto protege el terreno. Las paredes y los cañones **bajan la dosis**, y eso aparece en todos los mapas.

### 07 · Calidad del dato (2:00 – 2:15)
**C:** Una buena herramienta también te dice cuánto confiar en ella. En azul se marcan las **22 zonas** con modelo de terreno de alta resolución. Así la tripulación **decide con información** y sabe dónde le conviene ir con más cuidado.

### 08 · Detalles de ruta (2:15 – 2:35)
**B:** Una ruta se resume en cuatro números. Por ejemplo, del hábitat al área de boxwork:
- **14 kilómetros**,
- **3 horas 36 minutos**,
- **0.4 kilos de oxígeno** para dos astronautas,
- **0.045 milisieverts** de dosis.

Calcular una ruta de **19 kilómetros** sobre terreno real tarda **menos de medio segundo**, desde nuestro servidor en vivo.

### 09 · Perfil (2:35 – 2:50)
**B:** Además te explica el porqué: muestra la elevación a lo largo del camino y el tramo que conviene revisar. En esta ruta, CLHM encontró una opción **112 minutos más corta** con el mismo nivel de riesgo.

### 10 · Dos puntos (2:50 – 3:00)
**B:** ¿Quieres ir a otro lugar? Con **dos clics**, uno para el inicio y otro para el destino, tienes una ruta nueva en cualquier parte de **6,700 km²** de Gale, como rover o a pie.

### 11 · Tormenta solar (3:00 – 3:15)
**A:** Ahora, lo que nadie quiere vivir: una tormenta de partículas solares. CLHM busca al instante el **refugio natural más cercano** y la ruta más rápida para llegar. Tarda **0.12 segundos**. En una emergencia, ese tiempo importa.

### 12 · THEMIS (3:15 – 3:25)
**C:** También vemos lo que el ojo no ve. THEMIS, a bordo de Mars Odyssey, mide el calor del suelo de noche. La **roca firme** guarda el calor y la **arena suelta** se enfría rápido. Eso dice dónde pisar.

### 13 · Modo viaje (3:25 – 3:40)
**B:** Durante la caminata, CLHM te guía **tramo por tramo, con voz** y avisos desde la Tierra, para que la tripulación **mire el terreno y no la pantalla**.

### 14 · Datos abiertos (3:40 – 3:55)
**C:** Todo esto se construye con **10 conjuntos de datos abiertos** de la NASA y el USGS, integrados en un solo mapa. Cubrimos las **cuatro familias** de datos del reto: topografía, imagen orbital, radiación y térmico.

### 15 · En vivo (3:55 – 4:10)
**C:** Y no es un prototipo en papel: está en línea hoy. Pasa **42 de 42 pruebas automáticas** en laptop y teléfono y requiere **cero instalaciones**. Si quieren, ábranlo ahora mismo.

### 16 · Lo que sigue (4:10 – 4:25)
**A:** El siguiente paso es llevar la misma guía **al visor del casco**. También queremos sumar fotos de Mastcam y Navcam en cada sitio, clima en vivo con REMS y más modelos a 10 metros para afinar cada paso.

### 17 · Gracias (4:25 – 4:35)
**A:** Caminar en Marte va a pasar. Queremos que, cuando pase, nadie dé un paso a ciegas.
Escaneen el código y **planeen su primera caminata en Marte**. Gracias.

---

## Notas para presentar
- **Antes de cada cifra**, haz una pausa breve y deja que el contador termine. La animación es parte del énfasis.
- **Señala el círculo naranja** cuando aparezca, porque marca el dato del que estás hablando.
- **Si alguien abre la página en su teléfono** durante la diapositiva 15, aprovéchalo: "eso que ven es lo mismo que está en la pantalla".
- **Para recortar a 3 minutos**, quita las diapositivas 4, 10 y 12 y une 8 y 9 en una sola idea ("cuatro números y su porqué").

## Preguntas probables del jurado
| Pregunta | Respuesta corta |
|---|---|
| ¿Las rutas están validadas para astronautas? | Son rutas modeladas sobre los mismos datos con los que la NASA estudia este terreno. La app indica dónde el dato es más fino. Validarlas con procedimientos de misión es el paso natural siguiente. |
| ¿Qué tan exacta es la radiación? | La dosis base es medida: 315 días de Curiosity RAD. La protección del terreno es un modelo que ya distingue paredes y cañones; refinarlo es parte de la hoja de ruta. |
| ¿Funciona fuera de Gale? | El proceso de datos está automatizado con scripts. Llevarlo a otra zona significa descargar sus datos y reconstruir la red de rutas. |
| ¿Por qué web y no app nativa? | Para tener cero instalaciones y funcionar en cualquier pantalla. El mismo motor puede alimentar un visor de casco. |
| ¿Qué tan rápido es? | Menos de medio segundo para 19 km y 0.12 s para una evacuación, contando la red, desde el servidor en vivo. |
