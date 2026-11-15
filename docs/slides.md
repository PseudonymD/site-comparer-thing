# 7-slide outline (alternative to the video)

**Hard limit: 7 slides including the title slide.** Required content: team name, team members, the challenge, an image of the project, the user experience, and how open data and technology made it possible. Use screenshots of our own app only, with no NASA logos.

---

### 1. Title
**Terrestrial Analog Finder**: Earth's best stand-ins for the Moon and Mars
Team [TEAM: name] · [TEAM: members] · Cape Town, South Africa [TEAM: check]
NASA Space Apps 2026 · Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*
Image: full-width screenshot of the world heatmap (Jezero target).

### 2. The problem
- Astronauts and rovers train in places that resemble the Moon and Mars: Atacama, Iceland, Antarctica.
- Those analog sites are still picked mostly by expert intuition and history.
- Could we rank **every place on Earth** against the sites where bases will actually go, and say *why*?

### 3. What we built (image of the project)
Screenshot: map + site card for the western Qaidam Basin.
- 2.1 million land cells × 18 open data layers, scored live in the browser
- Six targets: lunar south pole, lunar lava-tube mare, Jezero, Gale, Arcadia Planitia, Mars north pole
- Each candidate explains itself in real units

### 4. The user experience
Three small screenshots: the weight sliders, the Discoveries tab, and Mars beside Earth.
- Pick a target, then reweight, filter, or "favour new places"
- Open a site: its match breakdown, a live 30 m terrain close-up, and planetary imagery side by side
- Share any view as a link; a guided tour for first-time visitors

### 5. Findings: does it work?
- **Jezero 0.92, Gale 0.94** ROC-AUC: Atacama, Death Valley and the MDRS land in Earth's top 2%
- Polar targets are weaker: they find the Dry Valleys (#26 of 2.1 M for the lunar south pole) but undervalue humid Arctic sites. We say so in the app.
- Discoveries: the cold high deserts of Central Asia. One of them, the Qaidam Basin, was proposed as a Mars analog in 2017, and our method found it independently.
- [TEAM: update the numbers from `pipeline/report.md` if basalt is published]

### 6. Southern Africa data
The generated data also covers Southern African landscapes.
- Richtersveld and the central Namib reach Earth's top ~2% for Mars Jezero and Gale; the Tankwa Karoo is in the top 4%
- Vredefort scores low: there's no impact layer, and the crater is eroded and in farmland. We report it honestly.
- Local analog sites could cut costs and grow African planetary science

### 7. Open data and technology made it possible
- NASA POWER, GIBS (MODIS NDVI, MERRA-2 aerosols, VIIRS Black Marble), SRTM, Moon/Mars Trek, plus NASA mission science (LOLA, Diviner, MOLA, REMS, MEDA)
- ISRIC SoilGrids, Natural Earth, AWS Terrain Tiles, Esri basemaps
- Python + TypeScript + MapLibre; a static site on Vercel; open source: github.com/PseudonymD/site-comparer-thing
- Built with help from Anthropic's Claude (Claude Code) under our direction; see the AI disclosure
- Live: **site-comparer-thing.vercel.app**
