# Background and Project Delimitation (Space Apps Challenge)

## 1. Background & Mission Context
Astronauts operating on the Martian surface face severe environmental challenges compared to Earth or lunar missions. Key operational constraints include:
- Radiation Environment: Mars lacks a strong magnetic field and dense atmosphere, making space weather data and radiation tracking critical for crew safety.
- Mobility Constraints: Conducting surface science while wearing bulky spacesuits, carrying scientific gear, and pulling/transporting supplies drastically limits physical agility, field of view, and stamina.
- Terrain Hazards: Navigating unfamiliar terrain requires avoiding major obstacles such as large rock formations, steep slopes, and treacherous craters.

---

## 2. Project Scope & Delimitation (What We Are Building)
To solve this challenge, our solution focuses on a specialized navigational tool/system tailored for Martian exploration:

- Interface & Form Factor (Choose/Implement one):
  - Spacecraft/habitat planning display.
  - Portable field tablet application for astronauts.
  - Heads-Up Display (HUD) projected onto the spacesuit helmet visor.
- Product Type: Can range from static snapshots and interactive digital mapping tools to dynamic systems generating custom routes based on live or historical telemetry.
- Temporal Focus: Can utilize past historical data, future predictive weather/radiation conditions, or focus purely on stable geographical layers like topography and geology.
- Immersive Visuals (POV): Integration of real perspective imagery (such as raw rover imagery from Mars surface missions) to give astronauts and planners a realistic preview of waypoints before arrival.
- Operational Dynamics: Consideration of crew mechanics (working in pairs) or robotic/rover support systems used to transport tools and heavy equipment.

---

## 3. Design Principles
- Scope Alignment: All features, routing algorithms, and UI designs must align with the safety, mobility, and scientific objective constraints outlined above.
- Data Integration: Prioritize combining environmental/radiation layers with topographical maps and rover point-of-view (POV) imagery to ensure maximum situational awareness for the simulated crew.

---

# PROJECT SPECIFICATION: INTERPLANETARY SURVIVAL GUIDE - MARTIAN MAP (MOUNT SHARP)
# NASA Space Apps Challenge 2026 - Mexico City (UNAM)

## 1. MISSION OBJECTIVE & SCIENTIFIC TARGET
- Location: Mount Sharp (Aeolis Mons), Gale Crater, Mars (Lat: 5.4° S, Lon: 137.8° E).
- Hyperlocal Scope: 5 km x 5 km operational quadrant covering Curiosity's traverse path toward the boxwork formations.
- Update (2026-11-14): the area of interest is now the whole terrain block of about 120 x 180 km (lon 137.20-138.40 E, lat 6.20-4.60 S), not only the 5 x 5 km quadrant. The quadrant (lat 5.44-5.36 S, lon 137.76-137.84 E) stays as a landmark; it is too steep for routes with current data. Curiosity's real boxwork area (about 4.80 S, 137.38 E, sols 4534-4844) is inside the block.
- Primary Scientific Goal: Plan and execute a safe human Extra-Vehicular Activity (Marswalk/EVA) from a simulated Habitat Base to inspect and sample mineral-rich boxwork structures (indicators of ancient groundwater activity) while ensuring crew survival.

## 2. OPERATIONAL & ENVIRONMENTAL CONSTRAINTS
- Radiation Environment: Mars lacks a global magnetosphere and dense atmosphere (<1% Earth pressure). System must track cumulative radiation dose (mSv) using Curiosity RAD instrument baselines and simulate Solar Particle Event (SPE) shelter routing.
- Mobility & Suit Constraints: Pressurized EVA suits restrict field of view, agility, and metabolic stamina. Terrain elevation changes directly impact oxygen (O2) and cooling water consumption.
- Terrain Hazards: Steep slopes (>15° for rover-assisted transport, >20° for foot traverse), sharp fractured bedrock (suit/wheel damage), and low-thermal-inertia sand traps.
- Operational Dynamics: Two-astronaut crew accompanied by a cargo support rover. Routing algorithm must enforce stricter slope and surface firmness constraints when rover support is active.

## 3. SYSTEM ARCHITECTURE & FORM FACTOR
- Form Factor: Portable Field Tablet / Habitat Tactical Planning Web Application (High-contrast responsive UI optimized for rapid situational awareness).
- Product Type: Interactive multi-layer digital mapping tool with dynamic weighted pathfinding (A* / Dijkstra cost matrix).
- Temporal Focus: Static high-resolution geological/topographical base layers combined with historical Curiosity telemetry and an interactive "Space Weather / Solar Storm Simulation" toggle.

## 4. REQUIRED NASA DATA LAYERS (MINIMUM 3 INTEGRATED)
1. Topographical Layer: Mars Reconnaissance Orbiter (MRO) HiRISE / MOLA Digital Elevation Model (DEM) to compute slope angles and elevation profiles.
2. Optical & Surface POV Layer: MRO HiRISE orbital imagery as base map + NASA Mars Rover Photos API (Curiosity Mastcam/Navcam) linked to specific waypoints to provide real first-person terrain previews before arrival.
3. Radiation & Atmospheric Layer: Curiosity Radiation Assessment Detector (RAD) historical dose rates + REMS environmental data to calculate safe EVA exposure budgets and trigger shelter alerts.
4. Geological / Thermal Layer: CRISM / THEMIS mineral and thermal inertia data to highlight boxwork scientific targets and flag loose sand hazards.

## 5. CORE FEATURES TO IMPLEMENT (MVP)
- Interactive Layer Toggle: Switch/blend Topography (Slope heatmap), Radiation zones, and Scientific Targets.
- Dynamic Safe-Route Calculator: User selects Start (Habitat) and Target (Boxwork Waypoint); system calculates optimal path minimizing slope, sand risk, and radiation exposure, outputting Distance (m), Estimated Time, O2 Cost, and Radiation Dose (mSv).
- Waypoint POV Inspector: Clicking any mission waypoint opens a modal displaying real Curiosity surface photography, geological notes, and hazard warnings.
- Emergency Mode ("Solar Storm Alert"): Toggle simulating an incoming SPE that dynamically recalculates the fastest path to the nearest natural terrain shelter (crater wall/cliff overhang).
