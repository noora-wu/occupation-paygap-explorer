# Occupation Gender Pay Gap Explorer

An interactive D3 bubble chart of occupation-level gender pay inequality in the United States. Each bubble is an occupation: horizontal position is the pay gap from equal hourly wages, height and size show the share of the workforce, and colour shows whether that occupation has grown or declined since 1981.

## View the site

https://noora-wu.github.io/occupation-paygap-explorer/

To run it locally, the page loads CSV files with JavaScript, so it needs a web server.

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/`.

D3 is loaded from a CDN, so viewing the page needs an internet connection.

## How to explore

- Move the year slider, or press Play years, to step through the timeline.
- Open How to use for a guide to the chart.
- Hover a bubble for wages, pay gap, and population.
- Click a bubble to lock that occupation and follow it across years.
- Filter all occupations, the largest gaps, or the ones closest to equality.
- Search for an occupation, then drag to pan and scroll to zoom.

## Project structure

```text
index.html          Page
css/styles.css      Layout and chart styles
js/all-occupations.js
data/               Yearly occupation wages and wage distributions
```

## Data

Derived from the Current Population Survey via the [Gender Pay Gap Dataset on Kaggle](https://www.kaggle.com/datasets/fedesoriano/gender-pay-gap-dataset).

The chart keeps occupations that have at least five male and five female wage samples in every displayed year.
