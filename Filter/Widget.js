///////////////////////////////////////////////////////////////////////////
// Copyright © 2014 Esri. All Rights Reserved.
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
///////////////////////////////////////////////////////////////////////////

define([
    'dojo/_base/declare',
    'dojo/_base/lang',
    'dojo/_base/query',
    'dojo/_base/html',
    'dojo/_base/array',
    'dojo/_base/fx',
    'dojo/promise/all',
    'dojo/Deferred',
    'dojo/dom-class',
    'dojo/on',
    'dijit/_WidgetsInTemplateMixin',
    'dijit/TitlePane',
    'dijit/form/Button',
    'jimu/BaseWidget',
    'jimu/dijit/Message',
    'jimu/dijit/DrawBox',
    'jimu/utils',
    'jimu/filterUtils',
    'jimu/dijit/FilterParameters',
    'jimu/LayerInfos/LayerInfos',
    'esri/layers/GraphicsLayer',
    'esri/layers/FeatureLayer',
    'esri/renderers/SimpleRenderer',
    'esri/InfoTemplate',
    'esri/symbols/jsonUtils',
    'esri/lang',
    'esri/request',
    './SingleTask',
    'jimu/dijit/LoadingShelter'
  ],
  function(declare, lang, query, html, array, fx, all, Deferred, domClass, on, _WidgetsInTemplateMixin,
    TitlePane, Button, BaseWidget, Message, DrawBox, jimuUtils, FilterUtils, FilterParameters, LayerInfos,
    GraphicsLayer, FeatureLayer, SimpleRenderer, InfoTemplate, symbolJsonUtils, esriLang,
    esriRequest, SingleTask) {

    return declare([BaseWidget, _WidgetsInTemplateMixin], {
      name: 'Query',
      baseClass: 'jimu-widget-query',
      isValidConfig:false,
      currentAttrs:null,
      tempResultLayer: null,

      operationalLayers: null,

      currentSingleTask: null,

      defaultDef: [],
      layerList: [],
      filterList: [],

      _getCurrentAttrs: function(){
        if(this.currentSingleTask){
          return this.currentSingleTask.getCurrentAttrs();
        }
        return null;
      },

      /*
      test:
      http://map.floridadisaster.org/GIS/rest/services/Events/FL511_Feeds/MapServer/4
      http://maps.usu.edu/ArcGIS/rest/services/MudLake/MudLakeMonitoringSites/MapServer/0
      http://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer/0
      1. if queryType is 1, it means that the query supports OrderBy and Pagination.
         such as: http://services2.arcgis.com/K1Xet5rYYN1SOWtq/ArcGIS/rest/services/
         USA_hostingFS/FeatureServer/0
      2. if queryType is 2, it means that the query supports objectIds, but
         doesn't support OrderBy or Pagination.
         such as: http://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer
      3. if queryType is 3, it means that the query doesn't support objectIds.
      */

      postMixInProperties: function(){
        this.inherited(arguments);
        this.operationalLayers = [];
        var strClearResults = this.nls.clearResults;
        var tip = esriLang.substitute({clearResults:strClearResults}, this.nls.operationalTip);
        this.nls.operationalTip = tip;
        if(this.config){
          this._updateConfig();
        }
      },

      _updateConfig: function(){
        if(this.config && this.config.filterSets && this.config.filterSets.length > 0){
          array.forEach(this.config.filterSets, lang.hitch(this, function(Configs){
            array.forEach(Configs, lang.hitch(this, function(singleConfig){
              this._rebuildFilter(singleConfig.url, singleConfig.filter);
            }));
          }));
        }
      },

      _rebuildFilter: function(url, filter){
        try{
          if(filter){
            delete filter.expr;
            var filterUtils = new FilterUtils();
            filterUtils.isHosted = jimuUtils.isHostedService(url);
            filterUtils.getExprByFilterObj(filter);
          }
        }catch(e){
          console.log(e);
        }
      },

      postCreate:function(){
        this.inherited(arguments);
        this._createMapLayerList();
        this._combineRadioCheckBoxWithLabel();
        this._initDrawBox();
        this._resetAndAddTempResultLayer();
        this._initSelf();
      },

      onOpen: function(){
        if(this.tempResultLayer){
          this.tempResultLayer.show();
        }
      },

      onActive: function(){
        this.map.setInfoWindowOnClick(false);
      },

      onDeActive: function(){
        //deactivate method of DrawBox dijit will call this.map.setInfoWindowOnClick(true) inside
        this.drawBox.deactivate();
      },

      onClose:function(){
        if(this.tempResultLayer){
          this.tempResultLayer.hide();
        }
        this._hideInfoWindow();
        this.drawBox.clear();
        this.inherited(arguments);
      },

      destroy:function(){
        this._hideInfoWindow();
        this.drawBox.clear();
        this._removeAllResultLayers(true);
        this.inherited(arguments);
      },


      _createMapLayerList: function() {
        this.defaultDef = [];
        this.layerList = [];
        LayerInfos.getInstance(this.map, this.map.itemInfo)
          .then(lang.hitch(this, function(operLayerInfos) {
            if(operLayerInfos._layerInfos && operLayerInfos._layerInfos.length > 0) {
              this.layerList = operLayerInfos._layerInfos;
                  array.forEach(this.layerList, lang.hitch(this, function(layer) {
                    if(layer.originOperLayer.layerType !== "ArcGISTiledMapServiceLayer" && typeof(layer.originOperLayer.featureCollection) === 'undefined') {

                      if(typeof(layer.layerObject._defnExpr) !== 'undefined') {
                        this.defaultDef.push({layer: layer.id, definition: layer.layerObject._defnExpr, visible: layer.layerObject.visible});
                      }
                      else if(typeof(layer.layerObject.defaultDefinitionExpression) !== 'undefined' &&
                        typeof(layer.layerObject.getDefinitionExpression()) === 'function' ) {
                        this.defaultDef.push({layer: layer.id, definition: layer.layerObject.getDefinitionExpression(), visible: layer.layerObject.visible});
                      }
                      else if(typeof(layer.layerObject.layerDefinitions) !== 'undefined') {
                        this.defaultDef.push({layer: layer.id, definition: layer.layerObject.layerDefinitions, visible: layer._visible});
                      }
                      else {
                        this.defaultDef.push({layer: layer.id, definition: "1=1", visible: layer.layerObject.visible});
                      }
                    }
                  }));
            }
          }));
      },


      _combineRadioCheckBoxWithLabel: function(){
        jimuUtils.combineRadioCheckBoxWithLabel(this.cbxUseSpatial, this.useSpatialLabel);
        jimuUtils.combineRadioCheckBoxWithLabel(this.cbxUseMapExtent, this.currentExtentLabel);
        jimuUtils.combineRadioCheckBoxWithLabel(this.cbxDrawGraphic, this.drawGraphicLabel);
        jimuUtils.combineRadioCheckBoxWithLabel(this.cbxOperational, this.operationalLayerLabel);
      },

      _isServiceSupportsOrderBy: function(layerInfo){
        var isSupport = false;
        if(layerInfo.advancedQueryCapabilities){
          if(layerInfo.advancedQueryCapabilities.supportsOrderBy){
            isSupport = true;
          }
        }
        return isSupport;
      },

      _isServiceSupportsPagination: function(layerInfo){
        var isSupport = false;
        if(layerInfo.advancedQueryCapabilities){
          if(layerInfo.advancedQueryCapabilities.supportsPagination){
            isSupport = true;
          }
        }
        return isSupport;
      },

      _tryLocaleNumber: function(value){
        var result = jimuUtils.localizeNumber(value);
        if(result === null || result === undefined){
          result = value;
        }
        return result;
      },

      _tryLocaleDate: function(date){
        var result = jimuUtils.localizeDate(date);
        if(!result){
          result = date.toLocaleDateString();
        }
        return result;
      },

      _resetAndAddTempResultLayer: function(){
        this._removeTempResultLayer();
        this.tempResultLayer = new GraphicsLayer();
        this.map.addLayer(this.tempResultLayer);
      },

      _removeTempResultLayer: function(){
        if(this.tempResultLayer){
          this.map.removeLayer(this.tempResultLayer);
        }
        this.tempResultLayer = null;
      },

      _removeAllResultLayers: function(/*optional*/ dontSlide){
        this._hideInfoWindow();
        this._removeTempResultLayer();
        this._removeAllOperatonalLayers();
        this._clearResultPage();
        //the default value of dontSlide is false.
        //if true, it means the widgte will destroy and it needn't slide.
        if(!dontSlide){
          this._fromCurrentPageToQueryList();
        }
      },

      _addOperationalLayer: function(resultLayer){
        this.operationalLayers.push(resultLayer);
        this.map.addLayer(resultLayer);
      },

      _fromCurrentPageToQueryList: function(){
        html.setStyle(this.queryList, 'display', 'block');

        if(html.getStyle(this.queryParams, 'display') === 'block'){
          this._slide(this.queryList, -100, 0);
          this._slide(this.queryParams, 0, 100);
        }
        else if(html.getStyle(this.queryResults, 'display') === 'block'){
          this._slide(this.queryList, -100, 0);
          this._slide(this.queryResults, 0, 100);
        }
      },

      _removeAllOperatonalLayers: function(){
        var layers = this.operationalLayers;
        while(layers.length > 0){
          var layer = layers[0];
          if(layer){
            this.map.removeLayer(layer);
          }
          layers[0] = null;
          layers.splice(0, 1);
        }
        this.operationalLayers = [];
      },

      _isConfigValid:function(){
        return this.config && typeof this.config === 'object';
      },

      _initDrawBox: function(){
        this.drawBox = new DrawBox({
          types: ['point', 'polyline', 'polygon'],
          map: this.map,
          showClear: true,
          keepOneGraphic: true
        });
        this.drawBox.placeAt(this.drawBoxDiv);
        this.drawBox.startup();
      },

      _initSelf:function(){
        var uniqueId = jimuUtils.getRandomString();
        var cbxName = "Query_" + uniqueId;
        this.cbxUseMapExtent.name = cbxName;
        this.cbxDrawGraphic.name = cbxName;

        this.paramsDijit = new FilterParameters();
        this.paramsDijit.placeAt(this.parametersDiv);
        this.paramsDijit.startup();

        this.isValidConfig = this._isConfigValid();
        if(!this.isValidConfig){
          html.setStyle(this.queriesNode, 'display', 'none');
          html.setStyle(this.invalidConfigNode, {
            display:'block',
            left:0
          });
          html.setStyle(this.btnClearAll, 'display', 'none');
          return;
        }

        var filters = this.config.filterSets;

        if(filters.length === 0){
          html.setStyle(this.queriesNode, 'display', 'none');
          html.setStyle(this.noQueryTipSection, 'display', 'block');
          html.setStyle(this.btnClearAll, 'display', 'none');
          return;
        }

        array.forEach(filters, lang.hitch(this, function(singleConfig, index){
          var name = singleConfig.name;
          var strTr = '<tr class="single-query jimu-table-row">' +
          '<td class="first-td"></td>' +
          '<td class="second-td">' +
            '<div class="query-name-div"></div><div class="query-name-input-hide"></div>' +
          '</td>' +
          '<td class="third-td">' +
            '<div class="arrow"></div>' +
          '</td>' +
          '</tr>';
          var tr = html.toDom(strTr);
          var queryNameDiv = query(".query-name-div", tr)[0];
          queryNameDiv.innerHTML = jimuUtils.stripHTML(name);
          html.place(tr, this.queriesTbody);
          this.own(on(queryNameDiv, "click", lang.hitch(this, this._onQueryListClicked)));

          tr.singleConfig = singleConfig;
          if(index % 2 === 0){
            html.addClass(tr, 'even');
          }
          else{
            html.addClass(tr, 'odd');
          }
        }));

      },

      _slide:function(dom, startLeft, endLeft){
        html.setStyle(dom, 'display', 'block');
        html.setStyle(dom, 'left', startLeft + "%");
        fx.animateProperty({
          node: dom,
          properties:{
            left:{
              start: startLeft,
              end: endLeft,
              units:'%'
            }
          },
          duration: 500,
          onEnd: lang.hitch(this, function(){
            html.setStyle(dom, 'left', endLeft);
            if(endLeft === 0){
              html.setStyle(dom, 'display', 'block');
            }
            else{
              html.setStyle(dom, 'display', 'none');
            }
          })
        }).play();
      },

      _onQueryListClicked:function(event){

        var target = event.target || event.srcElement;
        var tr = jimuUtils.getAncestorDom(target, lang.hitch(this, function(dom){
            return html.hasClass(dom, 'single-query');
        }), 10);
        if(!tr){
          return;
        }

        this.filterList = [];
        var singleConfig = tr.singleConfig;

        //console.log(singleConfig);


        var inputFlag = false;
        array.forEach(singleConfig.filters, lang.hitch(this, function(fltr) {

          var filterInfo = fltr.filter;
          var filterUtils = new FilterUtils();
          if(filterUtils.isAskForValues(filterInfo)) {
            inputFlag = true;
          }

          this._checkAllLayers({filterObj: fltr});
        }));

        if(inputFlag){
          //html.setStyle(this.parametersDiv, 'display', 'block');

          this._checkUserInput(singleConfig.filters, tr);
        }
        else{
          //html.setStyle(this.parametersDiv, 'display', 'none');

          //not asking for input, just execute layer def
          this.resetLayerDef();
          this.applyFilterToLayer(this.filterList);
        }



      },


      applyFilterToLayer: function(params) {
        //console.log(params);
        array.forEach(params, lang.hitch(this, function(param) {
          if((param.layer.originOperLayer.layerType).indexOf("MapService") > -1) {

            param.layer.layerObject.setLayerDefinitions(param.filter);
            param.layer.layerObject.setVisibility(true);

          } else {
            //it's a feature layer, just apply filter
            param.layer.layerObject.setDefinitionExpression(param.filter);
            param.layer.layerObject.setVisibility(true);
          }
        }));
      },

      // get tab layers
      _checkAllLayers: function(params) {
        array.forEach(this.layerList, lang.hitch(this, function(layer) {
          if(layer.newSubLayers.length > 0) {
            var buildExp = [];
            this._recurseOpLayers(layer.newSubLayers, params, buildExp);
          } else {
            if (params.filterObj.name === layer.title) {
              var newFilter = params.filterObj.filter.expr;
              this.filterList.push({layer:layer, filter:newFilter, originObject: layer});
            }
          }
        }));
      },

      _recurseOpLayers: function(pNode, params, build) {
        var nodeGrp = pNode;
        array.forEach(nodeGrp, lang.hitch(this, function(Node) {
          if(Node.newSubLayers.length > 0) {
            this._recurseOpLayers(Node.newSubLayers, params, build);
          } else {
            if (params.filterObj.name === Node.title) {
              var msSubId = Node.originOperLayer.mapService.subId;
              build[msSubId] = params.filterObj.filter.expr;
              if(this.filterList.length > 0) {
                array.forEach(this.filterList, lang.hitch(this, function(list) {
                  if(typeof(list.layer) !== 'undefined') {
                    if(list.layer === Node.parentLayerInfo)  {
                      list.filter[msSubId] = params.filterObj.filter.expr;
                    } else {
                      this.filterList.push({layer:Node.parentLayerInfo, filter:build, originObject: Node});
                    }
                  } else {
                    this.filterList.push({layer:Node.parentLayerInfo, filter:build, originObject: Node});
                  }
                }));
              } else {
                this.filterList.push({layer:Node.parentLayerInfo, filter:build, originObject: Node});
              }
            }
          }
        }));
      },


      resetLayerDef: function() {
        var queryNameInput = query(".query-name-input-show");
        array.forEach(queryNameInput, lang.hitch(this, function(input) {
          domClass.replace(input, "query-name-input-hide", "query-name-input-show");
        }));

        array.forEach(this.layerList, lang.hitch(this, function(layer) {
          array.forEach(this.defaultDef, lang.hitch(this, function(def) {
            if(def.layer === layer.id ) {
              if(typeof(layer.layerObject.defaultDefinitionExpression) !== 'undefined'){
                layer.layerObject.setDefinitionExpression(def.definition);
              }
              else if(typeof(layer.layerObject.layerDefinitions) !== 'undefined') {
                //layer.layerObject.setDefaultLayerDefinitions();
                layer.layerObject.setLayerDefinitions(def.definition);
              }
              else {
                layer.layerObject.setDefinitionExpression(def.definition);
              }

              layer.layerObject.setVisibility(def.visible);
            }
          }));
        }));
      },


      _checkUserInput: function(params, tr) {
        var arrParams = [];
        var queryNameInput = query(".query-name-input-hide", tr)[0];
        domClass.replace(queryNameInput, "query-name-input-show", "query-name-input-hide");

        array.forEach(params, lang.hitch(this, function(param) {
          array.forEach(this.filterList, lang.hitch(this, function(lyr) {
            if(lyr.originObject.title === param.name) {
               array.forEach(param.filter.parts, lang.hitch(this, function(part) {
                //show field context types (dates, numbers, etc)
                var inputParam = new FilterParameters();
                inputParam.placeAt(queryNameInput);
                inputParam.startup();

                var layerUrl = param.url;
                var partsObj = lang.clone(param.filter);
                if(lyr.originObject.parentLayerInfo !== null) {
                  var newFL = new FeatureLayer(param.url);
                  this.own(on(newFL, "load", lang.hitch(this, function() {
                    inputParam.build(layerUrl, newFL, partsObj);
                    arrParams.push(inputParam);
                  })));
                } else {
                  inputParam.build(layerUrl, lyr.layer.layerObject, partsObj);
                  arrParams.push(inputParam);
                }

              }));
            }
          }));
        }));

        var myButton = new Button({
            label: "Apply",
            onClick: lang.hitch(this, function(){
              var valid = this._modifyFilterInputs(arrParams);
              if(valid) {
                this.applyFilterToLayer(this.filterList);
              } else {
                //throw error message
              }

            })
        });
        myButton.placeAt(queryNameInput);
        myButton.startup();

      },

      _modifyFilterInputs: function(params) {
        var noInput = array.some(params, lang.hitch(this, function(param) {
          return (param.getFilterExpr() === null);
        }));
        if(noInput === true) {
          return false;
        } else {
          array.forEach(params, lang.hitch(this, function(param) {
              var expr = param.getFilterExpr();
              array.forEach(this.filterList, lang.hitch(this, function(lyr) {
                //console.log(param);
                //console.log(lyr);

                if(lyr.originObject.parentLayerInfo !== null) {
                  if(lyr.originObject.title === param.layerInfo.name) {
                    var buildExp =[];
                    buildExp[param.layerInfo.layerId] = expr;
                    lyr.filter = buildExp;
                    console.log(lyr);
                    //think about any need to append.
                  }
                } else {
                  if(lyr.originObject.id === param.layerInfo.id) {
                    lyr.filter = expr;
                    //think about any need to append.
                  }
                }
              }));
          }));
          return true;
        }
      },

      _getLayerInfoWithRelationships: function(layerUrl){
        var def = new Deferred();
        esriRequest({
          url: layerUrl,
          content: {
            f: 'json'
          },
          handleAs: 'json',
          callbackParamName: 'callback'
        }).then(lang.hitch(this, function(layerInfo){
          if(!layerInfo.relationships){
            layerInfo.relationships = [];
          }
          var serviceUrl = this._getServiceUrlByLayerUrl(layerUrl);
          var defs = array.map(layerInfo.relationships, lang.hitch(this, function(relationship){
            return esriRequest({
              url: serviceUrl + '/' + relationship.relatedTableId,
              content: {
                f: 'json'
              },
              handleAs: 'json',
              callbackParamName: 'callback'
            });
          }));
          all(defs).then(lang.hitch(this, function(results){
            array.forEach(results, lang.hitch(this, function(relationshipInfo, index){
              var relationship = layerInfo.relationships[index];
              relationship.name = relationshipInfo.name;
              //ignore shape field
              relationship.fields = array.filter(relationshipInfo.fields,
                lang.hitch(this, function(relationshipFieldInfo){
                return relationshipFieldInfo.type !== 'esriFieldTypeGeometry';
              }));
            }));
            def.resolve(layerInfo);
          }), lang.hitch(this, function(err){
            def.reject(err);
          }));
        }), lang.hitch(this, function(err){
          def.reject(err);
        }));
        return def;
      },

      _onCbxUseSpatialClicked: function(){
        if(this.cbxUseSpatial.checked){
          html.setStyle(this.selectSpatialDiv, 'display', 'block');
        }
        else{
          html.setStyle(this.selectSpatialDiv, 'display', 'none');
        }

        if (this.cbxUseMapExtent.checked) {
          this._onCbxUseMapExtentClicked();
        } else {
          this._onCbxDrawGraphicClicked();
        }

        this._resetDrawBox();
      },

      _onCbxUseMapExtentClicked: function(){
        if(this.cbxUseMapExtent.checked){
          this._resetDrawBox();
          html.setStyle(this.drawBoxDiv, 'display', 'none');
        }
      },

      _onCbxDrawGraphicClicked: function(){
        if(this.cbxDrawGraphic.checked){
          html.setStyle(this.drawBoxDiv, 'display', 'block');
        }
      },

      _onBtnClearAllClicked: function(){
        //this._removeAllResultLayers();
        this.resetLayerDef();
      },

      _resetDrawBox: function(){
        this.drawBox.deactivate();
        this.drawBox.clear();
      },

      _resetQueryParamsPage: function(){
        this.paramsDijit.clear();
        this.cbxOperational.checked = false;
        this.cbxUseSpatial.checked = false;
        this._onCbxUseSpatialClicked();
        this._resetDrawBox();
      },

      _getLayerIndexByLayerUrl: function(layerUrl){
        var lastIndex = layerUrl.lastIndexOf("/");
        var a = layerUrl.slice(lastIndex + 1, layerUrl.length);
        return parseInt(a, 10);
      },

      _getServiceUrlByLayerUrl: function(layerUrl){
        var lastIndex = layerUrl.lastIndexOf("/");
        var serviceUrl = layerUrl.slice(0, lastIndex);
        return serviceUrl;
      },

      _fromQueryListToQueryParams:function(){
        //reset UI of params page
        this._resetQueryParamsPage();
        var currentAttrs = this._getCurrentAttrs();

        //console.log(currentAttrs);
        array.forEach(currentAttrs.config.filters, lang.hitch(this, function(filter) {

          var layerUrl = filter.url;
          // this.btnResultsBack.innerHTML = '&lt; ' + this.nls.parameters;
          var partsObj = lang.clone(filter.filter);
          // this.paramsDijit.url = layerUrl;
          this.paramsDijit.build(layerUrl, currentAttrs.layerInfo, partsObj);

        }));

        //slide
        var showDom = this.queryParams;
        var hideDom = this.queryResults;

        html.setStyle(this.queryList, {
          left: 0,
          display: 'block'
        });

        html.setStyle(showDom, {
          left: '100%',
          display: 'block'
        });

        html.setStyle(hideDom, 'display', 'none');
        this._slide(this.queryList, 0, -100);
        this._slide(showDom, 100, 0);
      },

      _onBtnParamsBackClicked:function(){
        this._resetDrawBox();
        html.setStyle(this.queryList, 'display', 'block');
        html.setStyle(this.queryParams, 'display', 'block');
        html.setStyle(this.queryResults, 'display', 'none');
        this._slide(this.queryList, -100, 0);
        this._slide(this.queryParams, 0, 100);
      },

      //start to query
      _onBtnApplyClicked:function(){
        //reset result page
        this._clearResultPage();
        html.setStyle(this.resultsNumberDiv, 'display', 'none');

        var currentAttrs = this._getCurrentAttrs();

        var layerInfo = currentAttrs.layerInfo;

        //query{maxRecordCount,resultLayer,where,nextIndex,objectIds}
        //set query.where
        if(currentAttrs.askForValues){
          var newExpr = this.paramsDijit.getFilterExpr();
          var validExpr = newExpr && typeof newExpr === 'string';
          if(!validExpr){
            return;
          }
          currentAttrs.query.where = newExpr;
        }
        else{
          currentAttrs.query.where = currentAttrs.config.filter.expr;
        }

        //set query.maxRecordCount
        //maxRecordCount is added at 10.1
        currentAttrs.query.maxRecordCount = layerInfo.maxRecordCount || 1000;

        //set query.nextIndex
        currentAttrs.query.nextIndex = 0;

        //set query.objectIds
        currentAttrs.query.objectIds = [];

        var where = currentAttrs.query.where;

        var geometry = null;

        if(this.cbxUseSpatial.checked){
          if(this.cbxUseMapExtent.checked){
            geometry = this.map.extent;
          }
          else{
            var gs = this.drawBox.drawLayer.graphics;
            if(gs.length > 0){
              var g = gs[0];
              geometry = g.geometry;
            }
          }
          if(!geometry){
            new Message({message: this.nls.specifySpatialFilterMsg});
            return;
          }
        }

        //set query.geometry
        currentAttrs.query.geometry = geometry;

        if(this.tempResultLayer){
          this.map.removeLayer(this.tempResultLayer);
        }
        this.tempResultLayer = null;

        //set query.resultLayer
        this._createQueryResultLayer();

        this._resetDrawBox();

        html.setStyle(this.queryList, 'display', 'none');
        html.setStyle(this.queryParams, 'display', 'block');
        html.setStyle(this.queryResults, 'display', 'block');
        this._slide(this.queryParams, 0, -100);
        this._slide(this.queryResults, 100, 0);

        // this.currentSingleTask.executeQueryForFirstTime();
        var resultLayer = currentAttrs.query.resultLayer;

        var callback = lang.hitch(this, function(response) {
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          var allCount = currentAttrs.query.allCount;
          this.numSpan.innerHTML = jimuUtils.localizeNumber(allCount);
          if (allCount > 0) {
            if (resultLayer instanceof FeatureLayer) {
              this._addOperationalLayer(resultLayer);
            }
            var features = response.features;
            var relatedResults = response.relatedResults;
            var relatedTableIds = response.relatedTableIds;
            this._addResultItems(features, resultLayer, relatedResults, relatedTableIds);
          }
        });

        var errorCallback = lang.hitch(this, function(err) {
          console.error(err);
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          if (resultLayer) {
            this.map.removeLayer(resultLayer);
          }
          resultLayer = null;
          this._showQueryErrorMsg();
        });

        if(currentAttrs.queryType === 1){
          html.setStyle(this.resultsNumberDiv, 'display', 'block');
          this.shelter.show();
          this.currentSingleTask.doQuery_SupportOrderByAndPagination(where, geometry)
          .then(callback, errorCallback);
        }else if(currentAttrs.queryType === 2){
          html.setStyle(this.resultsNumberDiv, 'display', 'block');
          this.shelter.show();
          this.currentSingleTask.doQuery_SupportObjectIds(where, geometry)
          .then(callback, errorCallback);
        }else{
          this.currentSingleTask.doQuery_NotSupportObjectIds(where, geometry)
          .then(callback, errorCallback);
        }
      },

      _isSupportObjectIds: function(layerInfo){
        //http://resources.arcgis.com/en/help/arcgis-rest-api/#/Layer_Table/02r3000000zr000000/
        //currentVersion is added from 10.0 SP1
        //typeIdField is added from 10.0
        var currentVersion = 0;
        if(layerInfo.currentVersion){
          currentVersion = parseFloat(layerInfo.currentVersion);
        }
        return currentVersion >= 10.0 || layerInfo.hasOwnProperty('typeIdField');
      },

      _isImageServiceLayer: function(url) {
        return (url.indexOf('/ImageServer') > -1);
      },

      _isTable: function(layerDefinition){
        return layerDefinition.type === "Table";
      },

      _createQueryResultLayer: function(){
        var resultLayer = null;
        var renderer = null;

        var currentAttrs = this._getCurrentAttrs();

        if(currentAttrs.config.resultsSymbol){
          //if the layer is a table, resultsSymbol will be null
          var symbol = symbolJsonUtils.fromJson(currentAttrs.config.resultsSymbol);
          renderer = new SimpleRenderer(symbol);
        }

        if (this.cbxOperational.checked) {
          //new a feature layer
          var layerInfo = lang.clone(currentAttrs.layerInfo);
          var queryName = this._getBestQueryName(currentAttrs.config.name || '');

          //override layerInfo
          layerInfo.name = queryName;
          //ImageServiceLayer doesn't have drawingInfo
          if(!layerInfo.drawingInfo){
            layerInfo.drawingInfo = {};
          }
          if(renderer){
            layerInfo.drawingInfo.renderer = renderer.toJson();
          }

          layerInfo.drawingInfo.transparency = 0;
          layerInfo.minScale = 0;
          layerInfo.maxScale = 0;
          layerInfo.effectiveMinScale = 0;
          layerInfo.effectiveMaxScale = 0;
          layerInfo.defaultVisibility = true;
          delete layerInfo.extent;

          //only keep necessary fields
          var necessaryFieldNames = this._getOutputFields();
          layerInfo.fields = array.filter(layerInfo.fields, lang.hitch(this, function(fieldInfo){
            return necessaryFieldNames.indexOf(fieldInfo.name) >= 0;
          }));

          var featureCollection = {
            layerDefinition: layerInfo,
            featureSet: null
          };
          //Fornow, we should not add the FeatureLayer into map.
          resultLayer = new FeatureLayer(featureCollection);
        } else {
          //use graphics layer
          this._resetAndAddTempResultLayer();
          resultLayer = this.tempResultLayer;
        }

        currentAttrs.query.resultLayer = resultLayer;
        this.queryResults.resultLayer = resultLayer;

        //set renderer
        if(renderer){
          resultLayer.setRenderer(renderer);
        }

        return resultLayer;
      },

      _getBestQueryName: function(queryName){
        if(queryName){
          queryName += " _" + this.nls.queryResult;
        }
        else{
          queryName += this.nls.queryResult;
        }
        var finalName = queryName;
        var allNames = array.map(this.map.graphicsLayerIds, lang.hitch(this, function(glId){
          var layer = this.map.getLayer(glId);
          return layer.name;
        }));
        var flag = 2;
        while(array.indexOf(allNames, finalName) >= 0){
          finalName = queryName + '_' + flag;
          flag++;
        }
        return finalName;
      },

      _onResultsScroll:function(){
        if(!jimuUtils.isScrollToBottom(this.resultsContainer)){
          return;
        }

        //this.currentSingleTask.executeQueryWhenScrollToBottom();
        var currentAttrs = this._getCurrentAttrs();

        var resultLayer = currentAttrs.query.resultLayer;

        var callback = lang.hitch(this, function(response) {
          if (!this.domNode) {
            return;
          }
          this.shelter.hide();
          var features = response.features;
          var relatedResults = response.relatedResults;
          var relatedTableIds = response.relatedTableIds;
          this._addResultItems(features, resultLayer, relatedResults, relatedTableIds);
        });

        var errorCallback = lang.hitch(this, function(err) {
          console.error(err);
          if (!this.domNode) {
            return;
          }
          this._showQueryErrorMsg();
          this.shelter.hide();
        });

        var nextIndex = currentAttrs.query.nextIndex;

        if(currentAttrs.queryType === 1){
          var allCount = currentAttrs.query.allCount;
          if(nextIndex >= allCount){
            return;
          }

          this.currentSingleTask.onResultsScroll_SupportOrderByAndPagination()
          .then(callback, errorCallback);
        }else if(currentAttrs.queryType === 2){
          var allObjectIds = currentAttrs.query.objectIds;
          if(nextIndex >= allObjectIds.length){
            return;
          }
          this.currentSingleTask.onResultsScroll_SupportObjectIds().then(callback, errorCallback);
        }
      },

      /*-------------------------common functions----------------------------------*/
      _clearResultPage: function(){
        this._hideInfoWindow();
        this._unSelectResultTr();
        html.empty(this.resultsTbody);
        this.numSpan.innerHTML = '0';
      },

      _unSelectResultTr: function(){
        if(this.queryResults.resultTr){
          html.removeClass(this.queryResults.resultTr, 'jimu-state-active');
        }
        this.queryResults.resultTr = null;
      },

      _selectResultTr: function(tr){
        this._unSelectResultTr();
        this.queryResults.resultTr = tr;
        if(this.queryResults.resultTr){
          html.addClass(this.queryResults.resultTr, 'jimu-state-active');
        }
      },

      _zoomToLayer: function(gl){
        var currentAttrs = this._getCurrentAttrs();
        if(!this._isTable(currentAttrs.layerInfo)){
          var ext = jimuUtils.graphicsExtent(gl.graphics, 1.4);
          if(ext){
            this.map.setExtent(ext);
          }
        }
      },

      _getObjectIdField: function(){
        var currentAttrs = this._getCurrentAttrs();
        return currentAttrs.config.objectIdField;
      },

      _getOutputFields: function(){
        var currentAttrs = this._getCurrentAttrs();
        var fields = currentAttrs.config.popup.fields;
        var outFields = array.map(fields, lang.hitch(this, function(fieldInfo){
          return fieldInfo.name;
        }));
        //we need to add objectIdField into outFields because relationship query
        //needs objectId infomation
        var objectIdField = currentAttrs.config.objectIdField;
        if(array.indexOf(outFields, objectIdField) < 0){
          outFields.push(objectIdField);
        }
        //"Name:${CITY_NAME}, Population: ${POP}"
        var title = currentAttrs.config.popup.title;
        //["${CITY_NAME}", "${POP}"]
        var matches = title.match(/\$\{\w+\}/g);
        if(matches && matches.length > 0){
          array.forEach(matches, lang.hitch(this, function(match){
            //"${CITY_NAME}"
            var fieldName = match.replace('${', '').replace('}', '');
            if(outFields.indexOf(fieldName) < 0){
              outFields.push(fieldName);
            }
          }));
        }

        var allFieldInfos = currentAttrs.layerInfo.fields;
        var allFieldNames = array.map(allFieldInfos, lang.hitch(this, function(fieldInfo){
          return fieldInfo.name;
        }));
        //make sure every fieldName of outFields exists in fieldInfo
        outFields = array.filter(outFields, lang.hitch(this, function(fieldName){
          return allFieldNames.indexOf(fieldName) >= 0;
        }));

        return outFields;
      },

      _getCurrentRelationships: function(){
        var currentAttrs = this._getCurrentAttrs();
        return currentAttrs.queryTr.layerInfo.relationships || [];
      },

      _findRelationshipInfo: function(relationshipId){
        var relationships = this._getCurrentRelationships();
        for(var i = 0; i < relationships.length; i++){
          if(relationships[i].id === relationshipId){
            return relationships[i];
          }
        }
        return null;
      },

      _findRelationshipName: function(relationshipId){
        var relationshipName = '';
        var relationship = this._findRelationshipInfo(relationshipId);

        if(relationship){
          relationshipName = relationship.name;
        }

        return relationshipName;
      },

      _findRelationshipFields: function(relationshipId){
        var fields = [];

        var relationship = this._findRelationshipInfo(relationshipId);

        if(relationship){
          fields = relationship.fields;
        }

        return fields;
      },

      _getPopupFieldsWithFieldInfos: function(){
        var currentAttrs = this._getCurrentAttrs();
        var result = [];
        var allFieldInfos = lang.clone(currentAttrs.layerInfo.fields);
        var fieldInfosHash = {};
        array.forEach(allFieldInfos, lang.hitch(this, function(fieldInfo){
          fieldInfosHash[fieldInfo.name] = fieldInfo;
        }));
        var popupFields = lang.clone(currentAttrs.config.popup.fields);
        array.forEach(popupFields, lang.hitch(this, function(popupFieldInfo){
          //popupFieldInfo:{name,alias,specialType}
          var fieldName = popupFieldInfo.name;
          var fieldInfo = fieldInfosHash[fieldName];
          if(fieldInfo){
            //use popupFieldInfo.alias override fieldInfo.alias
            //add popupFieldInfo.specialType into fieldInfo.specialType
            fieldInfo = lang.mixin(fieldInfo, popupFieldInfo);
            result.push(fieldInfo);
          }
        }));
        return result;
      },

      _addResultItems: function(features, resultLayer, relatedResults, relatedTableIds){
        //var featuresCount = features.length;
        var currentAttrs = this._getCurrentAttrs();
        var sym = null;

        if(currentAttrs.config.resultsSymbol){
          //if the layer is a table, resultsSymbol will be null
          sym = symbolJsonUtils.fromJson(currentAttrs.config.resultsSymbol);
        }

        var allFieldInfos = lang.clone(currentAttrs.layerInfo.fields);

        var popupFields = this._getPopupFieldsWithFieldInfos();

        array.forEach(features, lang.hitch(this, function(feature, i){
          var trClass = '';
          if(i % 2 === 0){
            trClass = 'even';
          }
          else{
            trClass = 'odd';
          }

          //relationship attributes
          var relatedFeatures = [];
          if(relatedResults && relatedResults.length > 0){
            var objectIdField = currentAttrs.config.objectIdField;
            var objectId = feature.attributes[objectIdField];

            array.forEach(relatedResults, lang.hitch(this, function(relatedResult, idx){
              if(relatedResult[objectId]){
                var relatedName = this._findRelationshipName(relatedTableIds[idx]);
                var features = relatedResult[objectId].features;

                relatedFeatures.push({
                  tableId: relatedTableIds[idx],
                  name: relatedName,
                  features: features
                });
              }
            }));
          }

          if(feature.geometry){
            if(sym){
              feature.setSymbol(sym);
            }
          }

          resultLayer.add(feature);

          var options = {
            feature: feature,
            allFieldInfos: allFieldInfos,
            titleTemplate: currentAttrs.config.popup.title,
            fieldInfosInAttrContent: popupFields,
            trClass: trClass,
            relatedFeatures: relatedFeatures
          };

          this._createQueryResultItem(options);
        }));

        this._zoomToLayer(resultLayer);
      },

      _createQueryResultItem:function(options){
        var feature = options.feature;
        var allFieldInfos = options.allFieldInfos;
        var titleTemplate = options.titleTemplate;
        var fieldInfosInAttrContent = options.fieldInfosInAttrContent;
        var trClass = options.trClass;
        var relatedFeatures = options.relatedFeatures;

        var attributes = feature && feature.attributes;
        if(!attributes){
          return;
        }

        var strItem = '<tr class="jimu-table-row jimu-table-row-separator query-result-item" ' +
        ' cellpadding="0" cellspacing="0">' +
        '<td><span class="result-item-title"></span>' +
        '<table class="feature-attributes" valign="top">' +
        '<colgroup><col width="40%" /><col width="60%" /></colgroup>' +
        '<tbody></tbody></table></td></tr>';
        var trItem = html.toDom(strItem);
        html.addClass(trItem, trClass);
        html.place(trItem, this.resultsTbody);
        trItem.feature = feature;
        var spanTitle = query("span.result-item-title", trItem)[0];
        var tbody = query("tbody", trItem)[0];
        //We should not set value to attributes[fieldName] because it will influence the display
        //value in Attribute widget.
        var displayAttributes = jimuUtils.getBestDisplayAttributes(attributes, allFieldInfos);
        var title = esriLang.substitute(displayAttributes, titleTemplate);
        if(!title){
          title = this.nls.noValue;
        }
        spanTitle.innerHTML = title;
        var infoTemplateTitle = '';
        var infoTemplateContent = '';
        var rowsStr = "";

        array.forEach(fieldInfosInAttrContent, lang.hitch(this, function(fieldInfo){
          var fieldName = fieldInfo.name;
          var fieldAlias = fieldInfo.alias || fieldName;
          var displayValue = displayAttributes[fieldName];

          var fieldValueInWidget = displayValue;
          var fieldValueInPopup = displayValue;
          var specialType = fieldInfo.specialType;
          if(specialType === 'image'){
            if(displayValue && typeof displayValue === 'string'){
              fieldValueInWidget = '<a href="' + displayValue +
              '" target="_blank">' + displayValue + '</a>';
              fieldValueInPopup = '<img src="' + displayValue + '" />';
            }
          }
          else if(specialType === 'link'){
            if(displayValue && typeof displayValue === 'string'){
              fieldValueInWidget = '<a href="' + displayValue +
              '" target="_blank">' + displayValue + '</a>';
              fieldValueInPopup = fieldValueInWidget;
            }
          }

          if (displayValue === null || displayValue === undefined) {
            fieldValueInWidget = fieldValueInPopup = "";
          }

          var strFieldTr = '<tr><td class="attr-name">' + fieldAlias +
          ':</td><td class="attr-value">' + fieldValueInWidget + '</td></tr>';
          var fieldTr = html.toDom(strFieldTr);
          html.place(fieldTr, tbody);

          var rowStr = '<tr valign="top">' +
            '<td class="attr-name">' + fieldAlias + '</td>' +
            '<td class="attr-value">' + fieldValueInPopup + '</td>' +
          '</tr>';
          rowsStr += rowStr;
        }));

        //related features
        array.forEach(relatedFeatures, lang.hitch(this, function(relatedFeature){
          var trNode = html.create('tr');
          var tdNode = html.create('td', {
            colspan: 2
          }, trNode);
          var relationContainter = html.create('div');
          var titlePane = new TitlePane({
            title: this.nls.attributesFromRelationship + ': ' + relatedFeature.name,
            content: relationContainter,
            open: false,
            'class': 'relationship-attr'
          });
          titlePane.placeAt(tdNode);
          html.place(trNode, tbody);

          var rowStr = '<tr valign="top">' +
            '<td class="attr-name" colspan="2">' + this.nls.attributesFromRelationship + ": " +
              relatedFeature.name + '<td>' +
          '</tr>';
          rowsStr += rowStr;

          var relatedFields = this._findRelationshipFields(relatedFeature.tableId);

          array.forEach(relatedFeature.features, lang.hitch(this, function(feature, i){
            var strFieldTr = '<span>' + (i + 1) + '</span><br/>';
            var fieldTr = html.toDom(strFieldTr);
            html.place(fieldTr, relationContainter);

            var rowStr = '<tr valign="top"><td class="attr-name" colspan="2">' +
            (i + 1) + '</td><tr>';
            rowsStr += rowStr;

            if(relatedFields){
              array.forEach(relatedFields, lang.hitch(this, function(relatedFieldInfo){
                var fieldValue = feature.attributes[relatedFieldInfo.name];

                if(relatedFieldInfo.type === 'esriFieldTypeDate'){
                  if(fieldValue){
                    var date = new Date(parseInt(fieldValue, 10));
                    fieldValue = this._tryLocaleDate(date);
                  }
                }else if(typeof fieldValue === 'number'){
                  if(relatedFieldInfo.domain && relatedFieldInfo.domain.type === 'codedValue'){
                    array.some(relatedFieldInfo.domain.codedValues, function(codedValue){
                      if(codedValue.code === fieldValue){
                        fieldValue = codedValue.name;
                        return true;
                      }
                    });
                  }else{
                    fieldValue = this._tryLocaleNumber(fieldValue);
                  }
                }



                // var strFieldTr = '<span>' + (relatedFieldInfo.alias || relatedFieldInfo.name) +
                // ' : ' + fieldValue + '</span><br/>';
                // var fieldTr = html.toDom(strFieldTr);
                // html.place(fieldTr, relationContainter);

                var relatedAlias = relatedFieldInfo.alias || relatedFieldInfo.name;
                var rowStr = '<tr valign="top">' +
                    '<td class="attr-name">' + relatedAlias + '</td>' +
                    '<td class="attr-value">' + fieldValue + '</td>' +
                  '</tr>';
                rowsStr += rowStr;

                var strFieldRow = '<div class="related-row">' +
                    '<div class="related-name jimu-float-leading">' + relatedAlias + ':</div>' +
                    '<div class="related-value jimu-float-leading">' + fieldValue + '</div>' +
                '</div>';
                var fieldRowDiv = html.toDom(strFieldRow);
                html.place(fieldRowDiv, relationContainter);
              }));
            }
          }));
        }));

        infoTemplateContent = '<div class="header">' + title + '</div>';

        if(rowsStr){
          infoTemplateContent += '<div class="hzLine"></div>';
          infoTemplateContent += '<table class="query-popup-table" ' +
          ' cellpadding="0" cellspacing="0">' +
          '<colgroup><col width="40%" /><col width="60%" /></colgroup>' +
          '<tbody>' + rowsStr + '</tbody></table>';
        }

        infoTemplateContent = '<div class="query-popup">' + infoTemplateContent + '</div>';

        trItem.infoTemplateContent = infoTemplateContent;
        var infoTemplate = new InfoTemplate();
        //if title is empty, popup header will disappear
        if(this.map.infoWindow && this.map.infoWindow.declaredClass &&
           this.map.infoWindow.declaredClass.indexOf("PopupMobile") >= 0){
          //MobilePopup
          infoTemplateTitle = '<div class="query-popup-title">' + title + '</div>';
        }else{
          infoTemplateTitle = '<div class="query-popup-title"></div>';
        }
        infoTemplate.setTitle(infoTemplateTitle);
        trItem.infoTemplateTitle = infoTemplateTitle;
        infoTemplate.setContent(infoTemplateContent);
        feature.setInfoTemplate(infoTemplate);
      },

      _showQueryErrorMsg: function(/* optional */ msg){
        new Message({message: msg || this.nls.queryError});
      },

      _onResultsTableClicked: function(event){
        var target = event.target || event.srcElement;
        if(!html.isDescendant(target, this.resultsTable)){
          return;
        }
        var tr = jimuUtils.getAncestorDom(target, lang.hitch(this, function(dom){
          return html.hasClass(dom, 'query-result-item');
        }), 10);
        if(!tr){
          return;
        }

        this._selectResultTr(tr);

        //var spanTitle = query("span.result-item-title",tr)[0];
        //var featureAttrTable = query(".feature-attributes",tr)[0];
        //var attrTable = lang.clone(featureAttrTable);

        html.addClass(tr, 'jimu-state-active');
        var feature = tr.feature;
        var geometry = feature.geometry;
        if(geometry){
          var infoTitle = tr.infoTemplateTitle;
          var infoContent = tr.infoTemplateContent;
          var geoType = geometry.type;
          var centerPoint, extent;
          var def = null;

          if(geoType === 'point' || geoType === 'multipoint'){
            var singlePointFlow = lang.hitch(this, function(){
              def = new Deferred();
              var maxLevel = this.map.getNumLevels();
              var currentLevel = this.map.getLevel();
              var level2 = Math.floor(maxLevel * 2 / 3);
              var zoomLevel = Math.max(currentLevel, level2);
              if(this.map.getMaxZoom() >= 0){
                //use tiled layer as base map
                this.map.setLevel(zoomLevel).then(lang.hitch(this, function(){
                  this.map.centerAt(centerPoint).then(lang.hitch(this, function(){
                    def.resolve();
                  }));
                }));
              }else{
                //use dynamic layer
                this.map.centerAt(centerPoint).then(lang.hitch(this, function() {
                  def.resolve();
                }));
              }
            });

            if(geoType === 'point'){
              centerPoint = geometry;
              singlePointFlow();
            }
            else if(geoType === 'multipoint'){
              if(geometry.points.length === 1){
                centerPoint = geometry.getPoint(0);
                singlePointFlow();
              }
              else if(geometry.points.length > 1){
                extent = geometry.getExtent();
                if(extent){
                  extent = extent.expand(1.4);
                  centerPoint = geometry.getPoint(0);
                  def = this.map.setExtent(extent);
                }
              }
            }
          }
          else if(geoType === 'polyline'){
            extent = geometry.getExtent();
            extent = extent.expand(1.4);
            centerPoint = extent.getCenter();
            def = this.map.setExtent(extent);
          }
          else if(geoType === 'polygon'){
            extent = geometry.getExtent();
            extent = extent.expand(1.4);
            centerPoint = extent.getCenter();
            def = this.map.setExtent(extent);
          }
          else if(geoType === 'extent'){
            extent = geometry;
            extent = extent.expand(1.4);
            centerPoint = extent.getCenter();
            def = this.map.setExtent(extent);
          }

          if(def){
            def.then(lang.hitch(this, function(){
              if(typeof this.map.infoWindow.setFeatures === 'function'){
                this.map.infoWindow.setFeatures([feature]);
              }
              //if title is empty, popup header will disappear
              this.map.infoWindow.setTitle(infoTitle);
              this.map.infoWindow.setContent(infoContent);
              if(typeof this.map.infoWindow.reposition === 'function'){
                this.map.infoWindow.reposition();
              }
              this.map.infoWindow.show(centerPoint);
            }));
          }
        }
      },

      _hideInfoWindow:function(){
        if(this.map && this.map.infoWindow){
          this.map.infoWindow.hide();
          if(typeof this.map.infoWindow.setFeatures === 'function'){
            this.map.infoWindow.setFeatures([]);
          }
          this.map.infoWindow.setTitle('');
          this.map.infoWindow.setContent('');
        }
      },

      _onBtnResultsBackClicked: function(){
        var showDom, hideDom;

        showDom = this.queryParams;
        hideDom = this.queryList;

        html.setStyle(hideDom, 'display', 'none');
        html.setStyle(showDom, {
          display:'block',
          left:'-100%'
        });
        this._slide(showDom, -100, 0);
        this._slide(this.queryResults, 0, 100);
      }

    });
  });