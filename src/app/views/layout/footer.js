define([
  'jquery',
  'underscore',
  'backbone',
  'text!templates/layout/footer.html'
], function($, _, Backbone, FooterTemplate){
  var Footer = Backbone.View.extend({
    el: $('#footer'),

    initialize: function(options){
      this.state = options.state;
      this.template = _.template(FooterTemplate);
      this.render();
    },

    events: {
      'click .modal-link': 'onModalLink'
    },

    onModalLink: function(evt) {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();

      // Since this is a modal link, we need to make sure
      // our handler exists
      var modelFn = this.state.get('setModal');
      if (!modelFn) return false;

      modelFn(evt.target.dataset.modal);

      return false;
    },

    render: function(){
      this.$el.html(this.template());
      return this;
    }
  });

  return Footer;
});
