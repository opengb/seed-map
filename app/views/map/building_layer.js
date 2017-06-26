'use strict';

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

define(['jquery', 'underscore', 'backbone', 'collections/city_buildings', 'models/building_color_bucket_calculator', 'text!templates/map/building_info.html'], function ($, _, Backbone, CityBuildings, BuildingColorBucketCalculator, BuildingInfoTemplate) {

  var baseCartoCSS = {
    dots: ['{marker-fill: #CCC;' + 'marker-fill-opacity: 0.9;' + 'marker-line-color: #FFF;' + 'marker-line-width: 0.5;' + 'marker-line-opacity: 1;' + 'marker-placement: point;' + 'marker-multi-policy: largest;' + 'marker-type: ellipse;' + 'marker-allow-overlap: true;' + 'marker-clip: false;}'],
    footprints: ['{polygon-fill: #CCC;' + 'polygon-opacity: 0.9;' + 'line-width: 1;' + 'line-color: #FFF;' + 'line-opacity: 0.5;}']
  };

  var CartoStyleSheet = function CartoStyleSheet(tableName, bucketCalculator, mode) {
    this.tableName = tableName;
    this.bucketCalculator = bucketCalculator;
    this.mode = mode;
  };

  CartoStyleSheet.prototype.toCartoCSS = function () {
    var bucketCSS = this.bucketCalculator.toCartoCSS(),
        styles = [].concat(_toConsumableArray(baseCartoCSS[this.mode])).concat(bucketCSS),
        tableName = this.tableName;

    styles = _.reject(styles, function (s) {
      return !s;
    });
    styles = _.map(styles, function (s) {
      return "#" + tableName + " " + s;
    });
    return styles.join("\n");
  };

  var BuildingInfoPresenter = function BuildingInfoPresenter(city, allBuildings, buildingId, idKey) {
    this.city = city;
    this.allBuildings = allBuildings;
    this.buildingId = buildingId;
    this.idKey = idKey;
  };

  BuildingInfoPresenter.prototype.toLatLng = function () {
    var building = this.toBuilding();
    if (typeof building === 'undefined') return null;

    return { lat: building.get('lat'), lng: building.get('lng') };
  };

  BuildingInfoPresenter.prototype.toBuilding = function () {
    // var id_key = this.city.get(this.idKey);
    var id_key = this.city.get('property_id');
    return this.allBuildings.find(function (building) {
      return building.get('id') == this.buildingId;
      // return building.get(id_key) == this.buildingId;
    }, this);
  };

  BuildingInfoPresenter.prototype.toPopulatedLabels = function () {
    var default_hidden = false;
    return _.map(this.city.get('popup_fields'), function (field) {
      var suppress = false;
      if (field.start_hidden) default_hidden = true;
      var building = this.toBuilding();
      var value = typeof building === 'undefined' ? null : building.get(field.field);

      if (field.suppress_unless_field && field.suppress_unless_values && typeof building !== 'undefined' && field.suppress_unless_values.indexOf(building.get(field.suppress_unless_field)) === -1) {
        suppress = true; // do not display this field
      }

      // don't apply toLocaleString if it's a year, to prevent commas in year.
      return _.extend({
        value: field.isYear ? value || 'N/A' : (value || 'N/A').toLocaleString(),
        default_hidden: default_hidden,
        suppress: suppress
      }, field);
    }, this);
  };

  /*
    Determines which map layer should be showing on the map
    Currently hardwired to show 'dots' or 'footprints'
   */
  var BuildingLayerWatcher = function BuildingLayerWatcher(config, map) {
    this.config = config;
    this.map = map;
    this.currentZoom = null;
    this.footprintsAllowed = this.config.allowable || false;
    this.mode = this.getMode();
  };

  BuildingLayerWatcher.prototype.getMode = function () {
    if (!this.footprintsAllowed) return 'dots'; // `dots` are going to be our default

    var zoom = this.map.getZoom();
    if (this.currentZoom === zoom) return this.mode;
    this.currentZoom = zoom;

    return zoom >= this.config.atZoom ? 'footprints' : 'dots';
  };

  // Determines whether to change the layer type
  BuildingLayerWatcher.prototype.check = function () {
    if (!this.footprintsAllowed) return false;

    var mode = this.getMode();

    if (mode === this.mode) return false;

    this.mode = mode;

    return true;
  };

  BuildingLayerWatcher.prototype.fillType = function () {
    return this.mode === 'dots' ? 'marker-fill' : 'polygon-fill';
  };

  /*
    To render building footprints we need to join on the footprint table.
    There is no need to wrap it in the building collection sql function, since
    it only impacts the map layer. It does borrow most of the logic for sql
    generation from the building collection sql function however.
   */
  var FootprintGenerateSql = function FootprintGenerateSql(footprintConfig, maplayers) {
    this.footprintConfig = footprintConfig;
    this.mapLayerFields = maplayers.map(function (lyr) {
      return 'b.' + lyr.field_name;
    });
    this.mapLayerFields.push('b.id');
    this.mapLayerFields = this.mapLayerFields.join(',');
  };

  FootprintGenerateSql.prototype.sql = function (components) {
    var tableFootprint = this.footprintConfig.table_name;
    var tableData = components.table;

    // Base query
    var query = "SELECT a.*," + this.mapLayerFields + " FROM " + tableFootprint + " a," + tableData + " b WHERE a.buildingid = b.id AND ";

    var filterSql = components.year.concat(components.range).concat(components.category).filter(function (e) {
      return e.length > 0;
    });

    query += filterSql.join(' AND ');

    return query;
  };

  var LayerView = Backbone.View.extend({
    initialize: function initialize(options) {
      this.state = options.state;
      this.leafletMap = options.leafletMap;
      this.mapElm = $(this.leafletMap._container);

      this.allBuildings = new CityBuildings(null, {});

      this.footprints_cfg = this.state.get('city').get('building_footprints');
      this.buildingLayerWatcher = new BuildingLayerWatcher(this.footprints_cfg, this.leafletMap);

      this.footprintGenerateSql = new FootprintGenerateSql(this.footprints_cfg, this.state.get('city').get('map_layers'));

      // Listen for all changes but filter in the handler for these
      // attributes: layer, filters, categories, and tableName
      this.listenTo(this.state, 'change', this.changeStateChecker);

      // building has a different handler
      this.listenTo(this.state, 'change:building', this.onBuildingChange);
      this.listenTo(this.state, 'clear_map_popups', this.onClearPopups);
      this.listenTo(this.allBuildings, 'sync', this.render);

      var self = this;
      this.leafletMap.on('popupclose', function (e) {
        self.state.set({ building: null });
      });
      // register single handler for showing more attrs in popup
      $('body').on('click', '.show-hide-attrs', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var is_show = $(this).text().indexOf('more') > -1 ? true : false;
        if (is_show) {
          $(this).text('less details...');
          $('.show-more-container').removeClass('hide').addClass('show');
        } else {
          $(this).text('more details...');
          $('.show-more-container').removeClass('show').addClass('hide');
        }

        self.leafletMap.eachLayer(function (layer) {
          if (layer._tip) {
            self.adjustPopup(layer);
          }
        });
      });
    },

    // Keep popup in map view after showing more details
    adjustPopup: function adjustPopup(layer) {
      var container = $(layer._container);
      var latlng = layer.getLatLng();
      var mapSize = this.leafletMap.getSize();

      var pt = this.leafletMap.latLngToContainerPoint(latlng);
      var height = container.height();
      var top = pt.y - height;

      if (top < 0) {
        this.leafletMap.panBy([0, top]);
      }
    },

    onClearPopups: function onClearPopups() {
      var map = this.leafletMap;

      map.eachLayer(function (lyr) {
        if (lyr._tip) {
          map.removeLayer(lyr);
        }
      });
    },

    onBuildingChange: function onBuildingChange() {
      if (!this.state.get('building')) return;

      var propertyId = this.state.get('city').get('property_id');

      if (this.buildingLayerWatcher.mode !== 'dots') {
        propertyId = this.footprints_cfg.property_id;
      }

      var template = _.template(BuildingInfoTemplate),
          presenter = new BuildingInfoPresenter(this.state.get('city'), this.allBuildings, this.state.get('building'), propertyId);

      if (!presenter.toLatLng()) {
        console.warn('No building (%s) found for presenter!', presenter.buildingId);
        console.warn(presenter);
        console.warn(presenter.toLatLng());
        console.warn(presenter.toBuilding());
        console.warn('');
        return;
      }

      L.popup().setLatLng(presenter.toLatLng()).setContent(template({ labels: presenter.toPopulatedLabels() })).openOn(this.leafletMap);

      setTimeout(function () {
        this.state.trigger('building_layer_popup_shown');
      }.bind(this), 1);
    },

    onFeatureClick: function onFeatureClick(event, latlng, _unused, data) {
      var propertyId = this.state.get('city').get('property_id');

      if (this.buildingLayerWatcher.mode !== 'dots') {
        propertyId = this.footprints_cfg.property_id;
      }

      var buildingId = data[propertyId];

      var current = this.state.get('building');

      // Need to unset building if current is same
      // as buildingId or the popup will not appear
      if (current === buildingId) {
        this.state.unset('building', { silent: true });
      }

      this.state.set({ building: buildingId });
    },

    onFeatureOver: function onFeatureOver() {
      this.mapElm.css('cursor', "help");
    },
    onFeatureOut: function onFeatureOut() {
      this.mapElm.css('cursor', '');
    },

    onStateChange: function onStateChange() {
      // TODO: should not be mutating the buildings model.
      _.extend(this.allBuildings, this.state.pick('tableName', 'cartoDbUser'));
      this.allBuildings.fetch(this.state.get('year'));
    },

    changeStateChecker: function changeStateChecker() {
      // filters change
      if (this.state._previousAttributes.filters !== this.state.attributes.filters) {
        return this.onStateChange();
      }
      // layer change
      if (this.state._previousAttributes.layer !== this.state.attributes.layer) {
        return this.onStateChange();
      }
      // catergory change
      if (this.state._previousAttributes.categories !== this.state.attributes.categories) {
        return this.onStateChange();
      }
      // tableName change
      if (this.state._previousAttributes.tableName !== this.state.attributes.tableName) {
        return this.onStateChange();
      }

      // mapzoom change we need to re-render the map
      // to show either 'dots' or 'footprints'
      if (this.state._previousAttributes.zoom !== this.state.attributes.zoom) {
        if (this.buildingLayerWatcher.check()) this.render();
      }
    },

    toCartoSublayer: function toCartoSublayer() {
      var layerMode = this.buildingLayerWatcher.mode;
      var cssFillType = this.buildingLayerWatcher.fillType();

      var buildings = this.allBuildings,
          state = this.state,
          city = state.get('city'),
          year = state.get('year'),
          fieldName = state.get('layer'),
          cityLayer = _.findWhere(city.get('map_layers'), { field_name: fieldName }),
          buckets = cityLayer.range_slice_count,
          colorStops = cityLayer.color_range,
          calculator = new BuildingColorBucketCalculator(buildings, fieldName, buckets, colorStops, cssFillType),
          stylesheet = new CartoStyleSheet(buildings.tableName, calculator, layerMode);

      var sql = layerMode === 'dots' ? buildings.toSql(year, state.get('categories'), state.get('filters')) : this.footprintGenerateSql.sql(buildings.toSqlComponents(year, state.get('categories'), state.get('filters'), 'b.'));

      var cartocss = stylesheet.toCartoCSS();
      var interactivity = this.state.get('city').get('property_id');

      return {
        sql: sql,
        cartocss: cartocss,
        interactivity: layerMode === 'dots' ? interactivity : interactivity += ',' + this.footprints_cfg.property_id
      };
    },

    render: function render() {
      if (this.cartoLayer) {
        this.cartoLayer.getSubLayer(0).set(this.toCartoSublayer()).show();
        return this;
      }

      // skip if we are loading `cartoLayer`
      if (this.cartoLoading) return;

      this.cartoLoading = true;
      cartodb.createLayer(this.leafletMap, {
        user_name: this.allBuildings.cartoDbUser,
        type: 'cartodb',
        sublayers: [this.toCartoSublayer()]
      }, { https: true }).addTo(this.leafletMap).on('done', this.onCartoLoad, this);

      return this;
    },
    onCartoLoad: function onCartoLoad(layer) {
      this.cartoLoading = false;
      var sub = layer.getSubLayer(0);

      this.cartoLayer = layer;
      sub.setInteraction(true);
      sub.on('featureClick', this.onFeatureClick, this);
      sub.on('featureOver', this.onFeatureOver, this);
      sub.on('featureOut', this.onFeatureOut, this);
      this.onBuildingChange();
    }
  });

  return LayerView;
});