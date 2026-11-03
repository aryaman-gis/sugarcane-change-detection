// ======================================================
// BELAGAVI DISTRICT
// ======================================================
var districts = ee.FeatureCollection("projects/automation-of-indices/assets/District1");
var belagavi = districts.filter(ee.Filter.eq('KGISDist_1', 'Belagavi'));
Map.centerObject(belagavi, 9);

var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED");

// ======================================================
// FUNCTION TO PROCESS MONTH: FCC + NDVI + CLASSIFICATION
// ======================================================
function processMonth(month, year) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end   = start.advance(1, 'month');
  
  var image = s2.filterBounds(belagavi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .median().clip(belagavi);
    
  var ndvi = image.normalizedDifference(['B8','B4']).rename('NDVI');
  var monthName = start.format('MMMM').getInfo();

  // 1. FCC (False Color Composite)
  Map.addLayer(image, {bands:['B8','B4','B3'], min:0, max:3000}, monthName + ' FCC', false);

  // 2. NDVI map
  Map.addLayer(ndvi, {min:-1, max:1, palette:['blue','white','green']}, monthName + ' NDVI', false);

  // 3. Density slice (complete classified image)
  var slice = ee.Image(0)
    .where(ndvi.gte(-1).and(ndvi.lt(0)), 1)        // Water
    .where(ndvi.gte(0).and(ndvi.lt(0.2)), 2)       // Fallow
    .where(ndvi.gte(0.2).and(ndvi.lt(0.3)), 3)     // Scrub
    .where(ndvi.gte(0.30).and(ndvi.lt(0.40)), 4)   // Other crop-1
    .where(ndvi.gte(0.40).and(ndvi.lt(0.50)), 5)   // Sugarcane-1
    .where(ndvi.gte(0.50).and(ndvi.lt(0.60)), 6)   // Sugarcane-2
    .where(ndvi.gte(0.60).and(ndvi.lt(0.70)), 7)   // Forest-1
    .where(ndvi.gte(0.70), 8);                     // Forest-2

  Map.addLayer(slice, {
    min:1, max:8,
    palette:['#0000FF','#808080','#A9A9A9','#90EE90','#FFFF00','#FFD700','#006400','#004B23']
  }, monthName + ' Density Slice', false);

  // 4. Individual land-cover layers
  Map.addLayer(ndvi.updateMask(ndvi.gte(-1).and(ndvi.lt(0))), {palette:['#0000FF']}, monthName + ' Water');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0).and(ndvi.lt(0.2))), {palette:['#808080']}, monthName + ' Fallow');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.2).and(ndvi.lt(0.3))), {palette:['#A9A9A9']}, monthName + ' Scrub');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.30).and(ndvi.lt(0.40))), {palette:['#90EE90']}, monthName + ' Other crop-1');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.40).and(ndvi.lt(0.50))), {palette:['#FFFF00']}, monthName + ' Sugarcane-1');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.50).and(ndvi.lt(0.60))), {palette:['#FFD700']}, monthName + ' Sugarcane-2');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.60).and(ndvi.lt(0.70))), {palette:['#006400']}, monthName + ' Forest-1');
  Map.addLayer(ndvi.updateMask(ndvi.gte(0.70)), {palette:['#004B23']}, monthName + ' Forest-2');
}

// ======================================================
// MONTHS TO PROCESS
// ======================================================
var months = [1,2,3,5,11,12];

// Loop through months
months.forEach(function(m) {
  processMonth(m, 2020);
});

// ======================================================
// FUNCTION TO GET AREA (ha) PER CLASS
// ======================================================
function getAreaStats(month, year) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end   = start.advance(1, 'month');
  
  var image = s2.filterBounds(belagavi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .median().clip(belagavi);
    
  var ndvi = image.normalizedDifference(['B8','B4']).rename('NDVI');
  var monthName = start.format('MMMM').getInfo();

  // Classification
  var slice = ee.Image(0)
    .where(ndvi.gte(-1).and(ndvi.lt(0)), 1)        // Water
    .where(ndvi.gte(0).and(ndvi.lt(0.2)), 2)       // Fallow
    .where(ndvi.gte(0.2).and(ndvi.lt(0.3)), 3)     // Scrub
    .where(ndvi.gte(0.30).and(ndvi.lt(0.40)), 4)   // Other crop-1
    .where(ndvi.gte(0.40).and(ndvi.lt(0.50)), 5)   // Sugarcane-1
    .where(ndvi.gte(0.50).and(ndvi.lt(0.60)), 6)   // Sugarcane-2
    .where(ndvi.gte(0.60).and(ndvi.lt(0.70)), 7)   // Forest-1
    .where(ndvi.gte(0.70), 8);                     // Forest-2

  // Pixel area image (in hectares)
  var areaImage = ee.Image.pixelArea().divide(10000);

  // IMPORTANT: put area band first, class band second
  var areaStats = areaImage.addBands(slice).reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,   // group by class band (second band)
      groupName: 'class'
    }),
    geometry: belagavi.geometry(),
    scale: 10,
    maxPixels: 1e13
  }).get('groups');

  // Convert to FeatureCollection
  var features = ee.List(areaStats).map(function(item) {
    item = ee.Dictionary(item);
    return ee.Feature(null, {
      'month': monthName,
      'year': year,
      'class': item.get('class'),
      'area_ha': item.get('sum')
    });
  });

  return ee.FeatureCollection(features);
}

// ======================================================
// LOOP THROUGH MONTHS AND MERGE RESULTS
// ======================================================
var months = [1,2,3,5,11,12];
var allStats = ee.FeatureCollection([]);

months.forEach(function(m) {
  var fc = getAreaStats(m, 2020);
  allStats = allStats.merge(fc);
});

// ======================================================
// EXPORT TO DRIVE AS CSV (Excel-readable)
// ======================================================
Export.table.toDrive({
  collection: allStats,
  description: 'Belagavi_Area_Stats_2020',
  fileFormat: 'CSV'
});

Map.setCenter(74.826851,16.651814,17)
