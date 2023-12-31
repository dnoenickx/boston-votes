mapboxgl.accessToken = 'pk.eyJ1IjoiZG5vZW4iLCJhIjoiY2xlajhyemQzMDBqMTNwbG1jc2M2bTV4cSJ9.1nzFSXJN_zgrXDSA_s4D6Q';

function getMapStyle() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        return 'mapbox://styles/mapbox/dark-v11'
    return 'mapbox://styles/mapbox/light-v11'
}

const map = new mapboxgl.Map({
    container: 'map',
    style: getMapStyle(),
    center: [-71.087, 42.317],
    zoom: 11,
    minZoom: 7
});
map.addControl(new mapboxgl.NavigationControl());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => map.setStyle(getMapStyle()));


function generateCandidateListItem(name, votes, percent, color) {
    return `<li>
        <p class="block font-montserrat text-xl font-semibold text-gray-900 dark:text-white">${name}</p>
        <p class="block font-montserrat text-md font-light text-gray-900 dark:text-white">Votes: ${votes.toLocaleString()} | ${percent}%</p>
        <div class="mb-5 h-5 bg-gray-200 border-2 border-gray-300 dark:border-gray-600">
            <div class="h-4 ${color}" style="width: ${percent}%"></div>
        </div>
    </li>`;
}

function generateCandidateList(candidates) {
    let html = '';
    let colors = ["bg-amber-500", "bg-lime-400", "bg-sky-500", "bg-purple-400", "bg-rose-500", "bg-yellow-300", "bg-emerald-400", "bg-cyan-200", "bg-slate-400"];
    let defaultColor = "bg-zinc-300";
    for (let candIndex = 0; candIndex < candidates.length; candIndex += 1) {
        let candidate = candidates[candIndex];
        let color = candIndex > colors.length ? defaultColor : colors[candIndex];
        html += generateCandidateListItem(candidate['name'], candidate['votes'], candidate['percent'], color)
    }
    document.querySelector('#candidate-results').innerHTML = html;
}

function randomPoints(count, polygon, properties) {
    const positions = [];
    for (let i = 0; i < count; i++) {
        do {
            var pt = turf.randomPosition({ bbox: turf.bbox(polygon) });
        } while (!turf.booleanPointInPolygon(pt, polygon));
        positions.push(pt);
    }
    let points = positions.map(coord => turf.point(coord));
    if (properties !== undefined)
        points.forEach(pt => pt.properties = properties);
    return points
}

function shuffle(array) {
    let currentIndex = array.length, randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }

    return array;
}

function updateVisualization() {
    let url = `./data/${getSelectedElection()}-${getSelectedRace()}.json`;
    fetchOrCache(url).then(response => {
        response.json().then(json => {
            generateCandidateList(json["summary"]);

            let precinctPoints = [];
            for (let p of json["precincts"]) {
                let { ward, precinct, votes_cast } = p;
                let polygon = precincts.features.find(x => x["properties"]["precinct"] == precinct & x["properties"]["ward"] == ward);

                if (polygon === undefined) {
                    console.log(`Skipping. (ward: ${ward} precinct: ${precinct})`);
                    continue;
                }

                for (let candIndex = 0; candIndex < p["candidates"].length; candIndex += 1)
                    precinctPoints = [...precinctPoints, ...randomPoints(p["candidates"][candIndex]["votes"], polygon, { "candidate": candIndex })];
            }
            dotDensity = turf.featureCollection(shuffle(precinctPoints));
            map.getSource('dotDensity').setData(dotDensity);
            map.fitBounds(turf.bbox(dotDensity), {padding: 50});
        })
    });
}

async function fetchOrCache(url) {
    try {
        // Check if the URL is cached
        const cache = await caches.open('my-cache');
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
            return cachedResponse;
        }

        // If not cached, fetch the URL
        const response = await fetch(url);
        const clonedResponse = response.clone();
        await cache.put(url, clonedResponse);
        return response;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

function generateSelectOptions(options, selectValue) {
    let selectValueExists = selectValue ? options.some(({ value }) => value == selectValue) : false;
    let html = '';
    options.forEach(({ value, text }) => {
        html += `<option ${value == selectValue ? "selected" : ""} value="${value}">${text}</option>`;
    });
    return [html, selectValueExists];
}

async function electionDidChange(event) {
    let geometryURL = electionsList.find(x => x["date"] == getSelectedElection())["geometry"];
    precincts = await (await fetchOrCache(geometryURL)).json();
    map.getSource('precincts').setData(precincts);

    const election = electionsList.filter(e => e['date'] === getSelectedElection())[0];

    const [html, selectionMaintained] = generateSelectOptions(election["races"].map(r => ({ value: r["district"], text: r["title"] })), getSelectedRace());
    raceSelect.innerHTML = html;
    if (selectionMaintained)
        updateVisualization();
};

function getSelectedElection(){
    let index = electionSelect.selectedIndex;
    return index === -1 ? null : electionSelect.options[index].value;
}

function getSelectedRace(){
    let index = raceSelect.selectedIndex;
    return index === -1 ? null : raceSelect.options[index].value;
}

const electionSelect = document.getElementById('election-select');
const raceSelect = document.getElementById('race-select');

var electionsList = null;

fetchOrCache('data/list_elections.json').then(response => {
    response.json().then(json => {
        electionsList = json;
        electionSelect.innerHTML = generateSelectOptions(electionsList.map(e => ({ value: e["date"], text: e["title"] })));

    })
});

document.getElementById('election-select').addEventListener('change', electionDidChange);
document.getElementById('race-select').addEventListener('change', updateVisualization);


var dotDensity = turf.featureCollection([]);
var precincts = turf.featureCollection([]);

function loadLayers(){

    // Find the index of the first symbol layer in the map style.
    const layers = map.getStyle().layers;
    let firstSymbolId;
    for (const layer of layers) {
        if (layer.type === 'symbol') {
            firstSymbolId = layer.id;
            break;
        }
    }

    // Precincts
    map.addSource('precincts', {
        type: 'geojson',
        data: precincts,
    });
    map.addLayer({
        id: 'precinct-outlines',
        type: 'line',
        source: 'precincts',
        paint: {
            'line-color': '#627BC1',
            'line-opacity': 0.75
        }
    });

    // Dot Density

    map.addSource('dotDensity', {
        type: 'geojson',
        data: dotDensity,
    });
    map.addLayer(
        {
            id: 'points',
            type: 'circle',
            source: 'dotDensity',
            paint: {
                'circle-radius': {
                    'base': 1.75,
                    'stops': [
                        [12, 1.25],
                        [22, 180]
                    ]
                },
                'circle-color': [
                    'match',
                    ['get', 'candidate'],
                    0, "#f59e0b",
                    1, "#4ade80",
                    2, "#3b82f6",
                    3, "#c084fc",
                    4, "#f43f5e",
                    5, "#fde047",
                    6, "#67e8f9",
                    /* other */ '#94a3b8'
                ],
            }
        },
        firstSymbolId
    );

    // Precinct Hover

    let hoveredWardPrecint = null;

    map.addLayer(
        {
            id: 'hoevered-precinct-fill',
            type: 'fill',
            source: 'precincts',
            paint: {
                'fill-color': '#627BC1',
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.5,
                    0
                ]
            }
        },
        'aeroway-polygon'
    );

    map.on('mousemove', 'hoevered-precinct-fill', (e) => {
        if (e.features.length > 0) {
            if (hoveredWardPrecint !== null) {
                map.setFeatureState(
                    { source: 'precincts', id: hoveredWardPrecint },
                    { hover: false }
                );
            }
            hoveredWardPrecint = e.features[0].id;
            map.setFeatureState(
                { source: 'precincts', id: hoveredWardPrecint },
                { hover: true }
            );
        }
    });

    map.on('mouseleave', 'hoevered-precinct-fill', () => {
        if (hoveredWardPrecint !== null) {
            map.setFeatureState(
                { source: 'precincts', id: hoveredWardPrecint },
                { hover: false }
            );
        }
        hoveredWardPrecint = null;
    });
};


map.on('style.load', () => {
    const waiting = () => {
      if (!map.isStyleLoaded()) {
        setTimeout(waiting, 200);
      } else {
        loadLayers();
        electionDidChange().then(updateVisualization);
      }
    };
    waiting();
});