import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoidmFsYXUiLCJhIjoiY202MWtrZjhlMGw0eTJqcHl4aHBqc2M3eCJ9.vqMTDeNjunLGYJWNZUTJuw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});
// Helper function to convert station lon/lat to pixel coordinates using map.project()
// Placed globally so it can be used during map interactions
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Global time filter state and formatter
let timeFilter = -1; // -1 means no filter (any time)
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Compute station traffic (arrivals, departures, totalTraffic) from trips
function computeStationTraffic(stations, trips) {
    // Compute departures
    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
    );

    // Compute arrivals
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id,
    );

    // Update each station with arrivals/departures/totalTraffic
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

// Quantize scale for departure ratio -> discrete mix fraction
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Helpers for time filtering
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips
        : trips.filter((trip) => {
                const startedMinutes = minutesSinceMidnight(trip.started_at);
                const endedMinutes = minutesSinceMidnight(trip.ended_at);
                return (
                    Math.abs(startedMinutes - timeFilter) <= 60 ||
                    Math.abs(endedMinutes - timeFilter) <= 60
                );
            });
}

map.on('load', async () => {
  //code
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
    map.addLayer({
        id: 'bike-lanes-boston',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6,
        },
    });
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6,
        },
    });

    let jsonData;
    let stations = [];
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

        // Await JSON fetch and assign to outer-scoped variable
        jsonData = await d3.json(jsonurl);

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure

        // Safely access stations only if the expected structure exists
        if (jsonData && jsonData.data && Array.isArray(jsonData.data.stations)) {
            stations = jsonData.data.stations;
            console.log('Stations Array:', stations);
        } else {
            console.warn('JSON structure unexpected, could not find data.stations');
        }
    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

        // Select the SVG element inside the map container (per instructions)
        let svg = d3.select('#map').select('svg');
        // If no svg exists, create one so we can append circles
        if (svg.empty()) {
            svg = d3.select('#map')
                .append('svg')
                .style('position', 'absolute')
                .style('top', 0)
                .style('left', 0)
                .style('width', '100%')
                .style('height', '100%');
        }

        // Load station JSON and traffic CSV, then compute arrivals/departures and add traffic properties
        try {
            const tripsURL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

            // Load trips and parse dates into Date objects
            let trips = await d3.csv(tripsURL, (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            });

            // Compute station traffic initially (using all trips)
            stations = computeStationTraffic(stations, trips);

            // Create radius scale (sqrt) mapping totalTraffic to [0,25]
            let radiusScale = d3
                .scaleSqrt()
                .domain([0, d3.max(stations, (d) => d.totalTraffic)])
                .range([0, 25]);

            // Append circles to the SVG for each station using a key (short_name)
            svg
                .selectAll('circle')
                .data(stations, (d) => d.short_name)
                .enter()
                .append('circle')
                .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius by traffic
                .style('--departure-ratio', (d) => {
                    const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0.5;
                    return stationFlow(ratio);
                })
                .attr('fill', 'steelblue')
                .attr('stroke', 'white')
                .attr('stroke-width', 1)
                .attr('opacity', 0.6)
                .each(function (d) {
                    // Add <title> for browser tooltips
                    d3.select(this)
                        .append('title')
                        .text(
                            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
                        );
                });

            // Function to update circle positions when the map moves/zooms
            function updatePositions() {
                svg.selectAll('circle')
                    .attr('cx', (d) => getCoords(d).cx)
                    .attr('cy', (d) => getCoords(d).cy);
            }

            // Initial position update when map loads
            updatePositions();

            // Reposition markers on map interactions
            map.on('move', updatePositions);
            map.on('zoom', updatePositions);
            map.on('resize', updatePositions);
            map.on('moveend', updatePositions);

            // --- Time slider reactivity (Step 5.2) ---
            const timeSlider = document.getElementById('time-slider');
            const selectedTime = document.getElementById('time-display');
            const anyTimeLabel = document.getElementById('time-hint');

            function updateScatterPlot(timeFilter) {
                // Filter trips by time and recompute station traffic
                const filteredTrips = filterTripsbyTime(trips, timeFilter);
                const filteredStations = computeStationTraffic(stations, filteredTrips);

                // Adjust radius range depending on whether filtering is applied
                timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

                // Bind filtered stations with key and update circle sizes
                svg
                    .selectAll('circle')
                    .data(filteredStations, (d) => d.short_name)
                    .join('circle')
                    .attr('fill', 'steelblue')
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1)
                    .attr('opacity', 0.6)
                    .attr('r', (d) => radiusScale(d.totalTraffic))
                    .style('--departure-ratio', (d) => {
                        const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0.5;
                        return stationFlow(ratio);
                    })
                    .each(function (d) {
                        const t = d3.select(this).select('title');
                        const text = `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
                        if (t.empty()) {
                            d3.select(this).append('title').text(text);
                        } else {
                            t.text(text);
                        }
                    });

                // Update positions after size change
                updatePositions();
            }

            function updateTimeDisplay() {
                timeFilter = Number(timeSlider.value);
                if (timeFilter === -1) {
                    selectedTime.textContent = '';
                    anyTimeLabel.style.display = 'block';
                } else {
                    selectedTime.textContent = formatTime(timeFilter);
                    anyTimeLabel.style.display = 'none';
                }

                // Update the scatterplot based on the current timeFilter
                updateScatterPlot(timeFilter);
            }

            timeSlider.addEventListener('input', updateTimeDisplay);
            updateTimeDisplay();

        } catch (err) {
            console.error('Error loading station or trips data:', err);
        }
});
