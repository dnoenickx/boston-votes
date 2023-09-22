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
    let currentIndex = array.length,  randomIndex;
  
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

    let url = `/data/${selectedElection}-${selectedRace}.json`;
    fetchAndCacheDataForSession(url).then((raceData) => {
        generateCandidateList(raceData["summary"]);

        let precinctPoints = [];
        for (let p of raceData["precincts"]) {
            let { ward, precinct, votes_cast } = p;
            let polygon = precincts.features.find(x => x["properties"]["precinct"] == precinct & x["properties"]["ward"] == ward);

            if (polygon === undefined) {
                console.log(`Skipping. (ward: ${ward} precinct: ${precinct})`);
                continue;
            }

            for (let candIndex = 0; candIndex < p["candidates"].length; candIndex += 1)
                precinctPoints = [...precinctPoints, ...randomPoints(p["candidates"][candIndex]["votes"], polygon, {"candidate": candIndex})];
        }
        dotDensity = turf.featureCollection(shuffle(precinctPoints));
        map.getSource('dotDensity').setData(dotDensity);
    });
}


async function fetchAndCacheDataForSession(url) {
    const cacheKey = `cache_${url}`;
    // const cachedData = sessionStorage.getItem(cacheKey);
    // if (cachedData) {
    //     const parsedData = JSON.parse(cachedData);
    //     // console.log('Using cached data for URL:', url, parsedData);
    //     return parsedData;
    // }
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            console.log('Fetched and cached data for URL:', url, data);
            return data;
        })
        .catch(error => {
            console.error('Error fetching data for URL:', url, error);
            return null;
        });
}

function generateSelectOptions(options, defaultOption, selectValue) {
    let selectValueExists = selectValue ? options.some(({ value }) => value == selectValue) : false;
    let html = '';
    if (defaultOption !== undefined)
        html += `<option ${selectValueExists ? "" : "selected"} value="default">${defaultOption}</option>`;
    options.forEach(({ value, text }) => {
        html += `<option ${value == selectValue ? "selected" : ""} value="${value}">${text}</option>`;
    });
    return [html, selectValueExists];
}

function electionDidChange(event) {
    selectedElection = event.target.value;

    let geometryURL = electionsList.find(x => x["date"] == selectedElection)["geometry"];
    fetchAndCacheDataForSession(geometryURL).then((precinctsGeoJSON) => {
        precincts = precinctsGeoJSON;
        map.getSource('precincts').setData(precincts);
    });

    const election = electionsList.filter(e => e['date'] === selectedElection)[0];

    const selectedRace = raceSelect.options[raceSelect.selectedIndex].value;
    const [html, selectionMaintained] = generateSelectOptions(election["races"].map(r => ({ value: r["district"], text: r["title"] })), "Choose a race", selectedRace);
    raceSelect.innerHTML = html;
    if (selectionMaintained)
        updateVisualization();
};

function raceDidChange(event) {
    selectedRace = event.target.value;
    updateVisualization();
};

const electionSelect = document.getElementById('election-select');
const raceSelect = document.getElementById('race-select');

var selectedElection = null;
var selectedRace = null;

var electionsList = null;

fetchAndCacheDataForSession('/data/list_elections.json').then((res) => {
    electionSelect.innerHTML = generateSelectOptions(res.map(e => ({ value: e["date"], text: e["title"] })), "Choose an election");
    electionsList = res;
}
);

document.getElementById('election-select').addEventListener('change', electionDidChange);
document.getElementById('race-select').addEventListener('change', raceDidChange);


var dotDensity = turf.featureCollection([]);
var precincts = turf.featureCollection([]);

map.on('style.load', () => {

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


});