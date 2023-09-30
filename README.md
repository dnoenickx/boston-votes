# Boston Votes: Simplifying Access to Election Results

## Motivation

The City of Boston [publishes](https://www.boston.gov/departments/elections/state-and-city-boston-election-results) election results across hundreds of PDFs, each filled with dozens of tables detailing results at the precinct level. This makes it challenging to navigate and interpret, since most people (myself included) are not familiar with precinct boundaries. My goal is to make it easy to browse elections, viewing them on an interactive map that contextualizes the results geographically.

---

Data is scraped from the PDFs using Python. It's then visualized as a dot density map, created using MapBox. I chose to create a dot density map becuase it's good for visualizing numerous categories.


### Tech
- Python
- Mapbox
- Vanilla JavaScript
- Tailwind CSS
- HTML
- GitHub Pages
