define([
  'jquery',
  'underscore',
  'backbone',
  'd3',
  'text!templates/scorecards/charts/fueluse.html'
], function($, _, Backbone, d3, FuelUseTemplate){

  var FuelUseView = Backbone.View.extend({
    className: 'fueluse-chart',

    TYPICAL_CAR_EMMISSION: 4.7,

    initialize: function(options){
      this.template = _.template(FuelUseTemplate);
      this.formatters = options.formatters;
      this.data = options.data;

      this.fuels = [
        {
          label: 'Natural Gas',
          key: 'gas'
        },
        {
          label: 'Electric',
          key: 'electricity'
        },
        {
          label: 'Steam',
          key: 'steam'
        }
      ];
    },

    getMean: function(key, data) {
      if (data.pluck) {
        return d3.mean(data.pluck(key));
      } else {
        return d3.mean(data.map(d => d[key]));
      }
    },

    getSum: function(key, data) {
      if (data.pluck) {
        return d3.sum(data.pluck(key));
      } else {
        return d3.sum(data.map(d => d[key]));
      }
    },

    pctFormat: function(n) {
      var val = n * 100;
      return d3.format('.0f')(val);
    },

    chartData: function() {
      const data = this.data;
      let fuels = [...this.fuels];

      fuels.forEach(d => {
        d.emissions = {};
        d.emissions.pct = this.pctFormat(this.getMean(d.key + '_ghg_percent', data));
        d.emissions.amt = this.getMean(d.key + '_ghg', data);

        d.usage = {};
        d.usage.pct = this.pctFormat(this.getMean(d.key + '_pct', data));
        d.usage.amt = this.getMean(d.key, data);
      });

      fuels = fuels.filter(d => {
        return d.usage.amt > 0 && d.emissions.amt > 0;
      });

      var total_ghg_emissions = this.getSum('total_ghg_emissions', data);

      var totals = {
        usage: this.formatters.fixed(this.getSum('total_kbtu', data)),
        emissions: this.formatters.fixed(total_ghg_emissions)
      };

      return {
        fuels,
        totals,
        cars: this.formatters.fixedOne(total_ghg_emissions / this.TYPICAL_CAR_EMMISSION)
      };

    },

    getLabelSizes: function(labels) {
      const sizes = [];

      labels.each(function(){
        const pw = this.offsetWidth;
        const cw = this.firstChild.offsetWidth;

        if (pw === 0) return;

        sizes.push({
          elm: this,
          pw,
          cw,
          dirty: cw > pw,
          pct: +(this.style.width.replace('%', ''))
        });
      });

      return sizes;
    },

    adjSizes: function(labels, ct) {
      const sizes = this.getLabelSizes(labels);
      if (!sizes.length) return;

      let ctr = ct || 0;
      ctr += 1;
      if (ctr > 10) return;

      const dirty = _.findIndex(sizes, d => d.dirty);

      if (dirty > -1) {
        const available = sizes.filter(d => !d.dirty);

        let additional = 0;

        available.forEach(d => {
          additional += 1;
          d3.select(d.elm).style('width', (d.pct - 1) + '%');
        });

        d3.select(sizes[dirty].elm).style('width', (sizes[dirty].pct + additional) + '%');

        this.adjSizes(labels, ctr);
      }
    },

    hideLabels: function(labels) {
      const sizes = this.getLabelSizes(labels);
      sizes.forEach(d => {
        if (d.dirty) {
          d3.select(d.elm.firstChild).style('display', 'none');
        }
      });
    },


    fixlabels: function(selector) {
      const chart = d3.select(selector).select('#fuel-use-chart');

      const headerLabels = chart.select('.fc-bars').selectAll('.fc-header');
      this.adjSizes(headerLabels, 0);

      const barLabels = chart.select('.fc-bars').selectAll('.fc-bar');
      this.hideLabels(barLabels);

    },

    render: function(){
      var d = this.chartData();

      return this.template(d);
    }
  });

  return FuelUseView;
});