// advanced-search-system.js - Advanced Search Integration System
// Comprehensive search solution with Elasticsearch, autocomplete, typo tolerance, and faceted filters

const mongoose = require('mongoose');

class AdvancedSearchSystem {
  constructor() {
    this.isElasticsearchEnabled = process.env.ELASTICSEARCH_ENABLED === 'true';
    this.elasticsearchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    this.elasticsearchIndex = process.env.ELASTICSEARCH_INDEX || 'quicklocal_products';
    this.client = null;
    this.fallbackToMongo = true;
    this.searchCache = new Map();
    this.maxCacheSize = 1000;
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    if (this.isElasticsearchEnabled) {
      await this.initializeElasticsearch();
    }
    console.log('🔍 Advanced search system initialized');
  }

  async initializeElasticsearch() {
    try {
      // Try to import Elasticsearch client
      let Client;
      try {
        const { Client: ESClient } = require('@elastic/elasticsearch');
        Client = ESClient;
      } catch (error) {
        console.warn('⚠️ @elastic/elasticsearch package not found. Install with: npm install @elastic/elasticsearch');
        this.isElasticsearchEnabled = false;
        return;
      }

      this.client = new Client({
        node: this.elasticsearchUrl,
        maxRetries: 3,
        requestTimeout: 60000,
        sniffOnStart: true,
      });

      // Test connection
      await this.client.ping();
      console.log('✅ Elasticsearch connection established');

      // Create index with mappings if it doesn't exist
      await this.createIndexWithMappings();
      
    } catch (error) {
      console.warn('⚠️ Elasticsearch initialization failed:', error.message);
      console.log('📦 Falling back to MongoDB search');
      this.isElasticsearchEnabled = false;
    }
  }

  async createIndexWithMappings() {
    try {
      const indexExists = await this.client.indices.exists({
        index: this.elasticsearchIndex
      });

      if (!indexExists.body) {
        await this.client.indices.create({
          index: this.elasticsearchIndex,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: {
                analyzer: {
                  autocomplete_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'autocomplete_filter']
                  },
                  search_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase']
                  }
                },
                filter: {
                  autocomplete_filter: {
                    type: 'edge_ngram',
                    min_gram: 2,
                    max_gram: 20
                  }
                }
              }
            },
            mappings: {
              properties: {
                name: {
                  type: 'text',
                  analyzer: 'autocomplete_analyzer',
                  search_analyzer: 'search_analyzer',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256
                    }
                  }
                },
                description: {
                  type: 'text',
                  analyzer: 'standard'
                },
                category: {
                  type: 'keyword'
                },
                subcategory: {
                  type: 'keyword'
                },
                brand: {
                  type: 'keyword'
                },
                price: {
                  type: 'float'
                },
                originalPrice: {
                  type: 'float'
                },
                rating: {
                  type: 'float'
                },
                reviewCount: {
                  type: 'integer'
                },
                tags: {
                  type: 'keyword'
                },
                availability: {
                  type: 'boolean'
                },
                sellerId: {
                  type: 'keyword'
                },
                location: {
                  type: 'geo_point'
                },
                createdAt: {
                  type: 'date'
                },
                updatedAt: {
                  type: 'date'
                },
                images: {
                  type: 'keyword'
                },
                specifications: {
                  type: 'object',
                  dynamic: true
                }
              }
            }
          }
        });

        console.log(`✅ Elasticsearch index "${this.elasticsearchIndex}" created with mappings`);
      }
    } catch (error) {
      console.error('❌ Failed to create Elasticsearch index:', error);
      throw error;
    }
  }

  // Main search function with intelligent fallback
  async search(query, options = {}) {
    const searchOptions = {
      page: parseInt(options.page) || 1,
      limit: parseInt(options.limit) || 20,
      category: options.category,
      brand: options.brand,
      minPrice: options.minPrice,
      maxPrice: options.maxPrice,
      minRating: options.minRating,
      sortBy: options.sortBy || 'relevance',
      location: options.location,
      radius: options.radius || 50, // km
      ...options
    };

    // Check cache first
    const cacheKey = this.generateCacheKey(query, searchOptions);
    const cachedResult = this.getFromCache(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    let result;
    
    if (this.isElasticsearchEnabled) {
      try {
        result = await this.elasticsearchSearch(query, searchOptions);
      } catch (error) {
        console.warn('⚠️ Elasticsearch search failed, falling back to MongoDB:', error.message);
        result = await this.mongoSearch(query, searchOptions);
      }
    } else {
      result = await this.mongoSearch(query, searchOptions);
    }

    // Cache the result
    this.cacheResult(cacheKey, result);
    
    return result;
  }

  async elasticsearchSearch(query, options) {
    const must = [];
    const filter = [];

    // Main search query
    if (query && query.trim()) {
      must.push({
        multi_match: {
          query: query,
          fields: ['name^3', 'description^2', 'brand^2', 'tags'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          operator: 'or'
        }
      });
    } else {
      must.push({ match_all: {} });
    }

    // Filters
    if (options.category) {
      filter.push({ term: { category: options.category } });
    }
    
    if (options.brand) {
      filter.push({ term: { brand: options.brand } });
    }

    if (options.minPrice || options.maxPrice) {
      const priceRange = {};
      if (options.minPrice) priceRange.gte = options.minPrice;
      if (options.maxPrice) priceRange.lte = options.maxPrice;
      filter.push({ range: { price: priceRange } });
    }

    if (options.minRating) {
      filter.push({ range: { rating: { gte: options.minRating } } });
    }

    if (options.availability !== undefined) {
      filter.push({ term: { availability: options.availability } });
    }

    // Location-based search
    if (options.location && options.location.lat && options.location.lon) {
      filter.push({
        geo_distance: {
          distance: `${options.radius}km`,
          location: {
            lat: options.location.lat,
            lon: options.location.lon
          }
        }
      });
    }

    // Build sort
    const sort = this.buildElasticsearchSort(options.sortBy, options.location);

    // Calculate pagination
    const from = (options.page - 1) * options.limit;

    const searchBody = {
      index: this.elasticsearchIndex,
      body: {
        query: {
          bool: {
            must,
            filter
          }
        },
        sort,
        from,
        size: options.limit,
        aggs: {
          categories: {
            terms: { field: 'category', size: 20 }
          },
          brands: {
            terms: { field: 'brand', size: 20 }
          },
          priceRanges: {
            range: {
              field: 'price',
              ranges: [
                { to: 100 },
                { from: 100, to: 500 },
                { from: 500, to: 1000 },
                { from: 1000, to: 5000 },
                { from: 5000 }
              ]
            }
          },
          avgRating: {
            avg: { field: 'rating' }
          }
        },
        highlight: {
          fields: {
            name: {},
            description: {}
          }
        }
      }
    };

    const response = await this.client.search(searchBody);

    return this.formatElasticsearchResponse(response.body, options);
  }

  buildElasticsearchSort(sortBy, location) {
    const sort = [];

    switch (sortBy) {
      case 'price_low':
        sort.push({ price: { order: 'asc' } });
        break;
      case 'price_high':
        sort.push({ price: { order: 'desc' } });
        break;
      case 'rating':
        sort.push({ rating: { order: 'desc' } });
        break;
      case 'newest':
        sort.push({ createdAt: { order: 'desc' } });
        break;
      case 'popularity':
        sort.push({ reviewCount: { order: 'desc' } });
        break;
      case 'distance':
        if (location && location.lat && location.lon) {
          sort.push({
            _geo_distance: {
              location: {
                lat: location.lat,
                lon: location.lon
              },
              order: 'asc',
              unit: 'km'
            }
          });
        }
        break;
      default: // relevance
        sort.push({ _score: { order: 'desc' } });
    }

    return sort;
  }

  formatElasticsearchResponse(response, options) {
    const products = response.hits.hits.map(hit => ({
      ...hit._source,
      _id: hit._id,
      _score: hit._score,
      highlight: hit.highlight
    }));

    const facets = {
      categories: response.aggregations.categories.buckets.map(bucket => ({
        value: bucket.key,
        count: bucket.doc_count
      })),
      brands: response.aggregations.brands.buckets.map(bucket => ({
        value: bucket.key,
        count: bucket.doc_count
      })),
      priceRanges: response.aggregations.priceRanges.buckets.map(bucket => ({
        range: bucket.key,
        count: bucket.doc_count,
        from: bucket.from,
        to: bucket.to
      })),
      avgRating: response.aggregations.avgRating.value
    };

    const totalHits = response.hits.total.value || response.hits.total;

    return {
      products,
      facets,
      pagination: {
        page: options.page,
        limit: options.limit,
        total: totalHits,
        pages: Math.ceil(totalHits / options.limit),
        hasNext: options.page * options.limit < totalHits,
        hasPrev: options.page > 1
      },
      searchInfo: {
        query: options.originalQuery,
        took: response.took,
        engine: 'elasticsearch',
        totalResults: totalHits
      }
    };
  }

  async mongoSearch(query, options) {
    try {
      const Product = mongoose.model('Product');
      
      // Build MongoDB query
      const mongoQuery = {};
      const orConditions = [];

      if (query && query.trim()) {
        const searchRegex = new RegExp(query.trim(), 'i');
        orConditions.push(
          { name: searchRegex },
          { description: searchRegex },
          { brand: searchRegex },
          { tags: { $in: [searchRegex] } }
        );
      }

      if (orConditions.length > 0) {
        mongoQuery.$or = orConditions;
      }

      // Filters
      if (options.category) {
        mongoQuery.category = options.category;
      }
      
      if (options.brand) {
        mongoQuery.brand = options.brand;
      }

      if (options.minPrice || options.maxPrice) {
        mongoQuery.price = {};
        if (options.minPrice) mongoQuery.price.$gte = options.minPrice;
        if (options.maxPrice) mongoQuery.price.$lte = options.maxPrice;
      }

      if (options.minRating) {
        mongoQuery.rating = { $gte: options.minRating };
      }

      if (options.availability !== undefined) {
        mongoQuery.availability = options.availability;
      }

      // Location-based search
      if (options.location && options.location.lat && options.location.lon) {
        mongoQuery.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [options.location.lon, options.location.lat]
            },
            $maxDistance: options.radius * 1000 // Convert km to meters
          }
        };
      }

      // Build sort
      const sort = this.buildMongoSort(options.sortBy);

      // Execute query with pagination
      const skip = (options.page - 1) * options.limit;
      
      const [products, total, facets] = await Promise.all([
        Product.find(mongoQuery)
          .sort(sort)
          .skip(skip)
          .limit(options.limit)
          .lean(),
        Product.countDocuments(mongoQuery),
        this.getMongoFacets(mongoQuery)
      ]);

      return {
        products,
        facets,
        pagination: {
          page: options.page,
          limit: options.limit,
          total,
          pages: Math.ceil(total / options.limit),
          hasNext: options.page * options.limit < total,
          hasPrev: options.page > 1
        },
        searchInfo: {
          query: options.originalQuery,
          engine: 'mongodb',
          totalResults: total
        }
      };

    } catch (error) {
      console.error('❌ MongoDB search failed:', error);
      return {
        products: [],
        facets: {},
        pagination: {
          page: 1,
          limit: options.limit,
          total: 0,
          pages: 0,
          hasNext: false,
          hasPrev: false
        },
        searchInfo: {
          query: options.originalQuery,
          engine: 'mongodb',
          totalResults: 0,
          error: error.message
        }
      };
    }
  }

  buildMongoSort(sortBy) {
    switch (sortBy) {
      case 'price_low':
        return { price: 1 };
      case 'price_high':
        return { price: -1 };
      case 'rating':
        return { rating: -1 };
      case 'newest':
        return { createdAt: -1 };
      case 'popularity':
        return { reviewCount: -1 };
      default: // relevance - use a combination of factors
        return { rating: -1, reviewCount: -1, createdAt: -1 };
    }
  }

  async getMongoFacets(baseQuery) {
    try {
      const Product = mongoose.model('Product');
      
      const [categories, brands, priceStats] = await Promise.all([
        Product.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]),
        Product.aggregate([
          { $match: baseQuery },
          { $group: { _id: '$brand', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 }
        ]),
        Product.aggregate([
          { $match: baseQuery },
          {
            $group: {
              _id: null,
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' },
              avgPrice: { $avg: '$price' },
              avgRating: { $avg: '$rating' }
            }
          }
        ])
      ]);

      return {
        categories: categories.map(cat => ({
          value: cat._id,
          count: cat.count
        })),
        brands: brands.map(brand => ({
          value: brand._id,
          count: brand.count
        })),
        priceRanges: this.generatePriceRanges(priceStats[0]),
        avgRating: priceStats[0]?.avgRating || 0
      };
    } catch (error) {
      console.error('❌ Failed to get MongoDB facets:', error);
      return {
        categories: [],
        brands: [],
        priceRanges: [],
        avgRating: 0
      };
    }
  }

  generatePriceRanges(priceStats) {
    if (!priceStats) return [];

    const { minPrice, maxPrice } = priceStats;
    const ranges = [
      { range: '0-100', from: 0, to: 100 },
      { range: '100-500', from: 100, to: 500 },
      { range: '500-1000', from: 500, to: 1000 },
      { range: '1000-5000', from: 1000, to: 5000 },
      { range: '5000+', from: 5000, to: null }
    ];

    return ranges.filter(range => {
      if (range.to === null) return maxPrice >= range.from;
      return maxPrice >= range.from && minPrice <= range.to;
    });
  }

  // Autocomplete search
  async autocomplete(query, options = {}) {
    const limit = options.limit || 10;
    
    if (!query || query.length < 2) {
      return [];
    }

    if (this.isElasticsearchEnabled) {
      try {
        return await this.elasticsearchAutocomplete(query, limit);
      } catch (error) {
        console.warn('⚠️ Elasticsearch autocomplete failed, using MongoDB:', error.message);
        return await this.mongoAutocomplete(query, limit);
      }
    } else {
      return await this.mongoAutocomplete(query, limit);
    }
  }

  async elasticsearchAutocomplete(query, limit) {
    const response = await this.client.search({
      index: this.elasticsearchIndex,
      body: {
        query: {
          bool: {
            should: [
              {
                match_phrase_prefix: {
                  name: {
                    query: query,
                    boost: 3
                  }
                }
              },
              {
                match: {
                  name: {
                    query: query,
                    fuzziness: 'AUTO',
                    boost: 2
                  }
                }
              },
              {
                match: {
                  brand: {
                    query: query,
                    boost: 1.5
                  }
                }
              }
            ]
          }
        },
        size: limit,
        _source: ['name', 'brand', 'category', 'price', 'images']
      }
    });

    return response.body.hits.hits.map(hit => ({
      id: hit._id,
      text: hit._source.name,
      brand: hit._source.brand,
      category: hit._source.category,
      price: hit._source.price,
      image: hit._source.images?.[0],
      score: hit._score
    }));
  }

  async mongoAutocomplete(query, limit) {
    try {
      const Product = mongoose.model('Product');
      const searchRegex = new RegExp(query, 'i');
      
      const products = await Product.find({
        $or: [
          { name: searchRegex },
          { brand: searchRegex }
        ]
      })
      .select('name brand category price images')
      .limit(limit)
      .lean();

      return products.map(product => ({
        id: product._id,
        text: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
        image: product.images?.[0]
      }));
    } catch (error) {
      console.error('❌ MongoDB autocomplete failed:', error);
      return [];
    }
  }

  // Search suggestions based on user behavior
  async getSearchSuggestions(query, userId = null, limit = 5) {
    const suggestions = [];
    
    try {
      // Get popular searches
      const popularSearches = await this.getPopularSearches(limit);
      suggestions.push(...popularSearches.map(s => ({
        text: s.query,
        type: 'popular',
        count: s.count
      })));

      // Get category suggestions
      if (query.length >= 2) {
        const categoryMatches = await this.getCategorySuggestions(query, limit);
        suggestions.push(...categoryMatches.map(c => ({
          text: c,
          type: 'category'
        })));
      }

      // Get brand suggestions
      if (query.length >= 2) {
        const brandMatches = await this.getBrandSuggestions(query, limit);
        suggestions.push(...brandMatches.map(b => ({
          text: b,
          type: 'brand'
        })));
      }

      // Remove duplicates and limit results
      const uniqueSuggestions = suggestions
        .filter((item, index, self) => 
          index === self.findIndex(t => t.text === item.text)
        )
        .slice(0, limit);

      return uniqueSuggestions;
    } catch (error) {
      console.error('❌ Failed to get search suggestions:', error);
      return [];
    }
  }

  async getPopularSearches(limit) {
    // This would typically come from a search analytics collection
    // For now, return some mock popular searches
    return [
      { query: 'smartphone', count: 1250 },
      { query: 'laptop', count: 980 },
      { query: 'headphones', count: 750 },
      { query: 'watch', count: 620 },
      { query: 'shoes', count: 580 }
    ].slice(0, limit);
  }

  async getCategorySuggestions(query, limit) {
    try {
      const Product = mongoose.model('Product');
      const categories = await Product.distinct('category', {
        category: new RegExp(query, 'i')
      });
      return categories.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  async getBrandSuggestions(query, limit) {
    try {
      const Product = mongoose.model('Product');
      const brands = await Product.distinct('brand', {
        brand: new RegExp(query, 'i')
      });
      return brands.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  // Index a single product to Elasticsearch
  async indexProduct(productData) {
    if (!this.isElasticsearchEnabled) return;

    try {
      await this.client.index({
        index: this.elasticsearchIndex,
        id: productData._id || productData.id,
        body: {
          ...productData,
          updatedAt: new Date()
        }
      });
    } catch (error) {
      console.error('❌ Failed to index product to Elasticsearch:', error);
    }
  }

  // Update product in Elasticsearch
  async updateProduct(productId, updateData) {
    if (!this.isElasticsearchEnabled) return;

    try {
      await this.client.update({
        index: this.elasticsearchIndex,
        id: productId,
        body: {
          doc: {
            ...updateData,
            updatedAt: new Date()
          }
        }
      });
    } catch (error) {
      console.error('❌ Failed to update product in Elasticsearch:', error);
    }
  }

  // Delete product from Elasticsearch
  async deleteProduct(productId) {
    if (!this.isElasticsearchEnabled) return;

    try {
      await this.client.delete({
        index: this.elasticsearchIndex,
        id: productId
      });
    } catch (error) {
      console.error('❌ Failed to delete product from Elasticsearch:', error);
    }
  }

  // Bulk index products
  async bulkIndexProducts(products) {
    if (!this.isElasticsearchEnabled || !products.length) return;

    try {
      const body = [];
      
      products.forEach(product => {
        body.push({
          index: {
            _index: this.elasticsearchIndex,
            _id: product._id || product.id
          }
        });
        body.push({
          ...product,
          updatedAt: new Date()
        });
      });

      const response = await this.client.bulk({ body });
      
      if (response.body.errors) {
        console.error('❌ Bulk indexing had errors:', response.body.errors);
      } else {
        console.log(`✅ Successfully indexed ${products.length} products`);
      }
    } catch (error) {
      console.error('❌ Bulk indexing failed:', error);
    }
  }

  // Cache management
  generateCacheKey(query, options) {
    return JSON.stringify({ query, ...options });
  }

  getFromCache(key) {
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    if (cached) {
      this.searchCache.delete(key);
    }
    return null;
  }

  cacheResult(key, data) {
    if (this.searchCache.size >= this.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }
    
    this.searchCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.searchCache.clear();
  }

  // Health check
  async healthCheck() {
    const health = {
      status: 'healthy',
      elasticsearch: {
        enabled: this.isElasticsearchEnabled,
        connected: false
      },
      mongodb: {
        connected: mongoose.connection.readyState === 1
      },
      cache: {
        size: this.searchCache.size,
        maxSize: this.maxCacheSize
      }
    };

    if (this.isElasticsearchEnabled && this.client) {
      try {
        await this.client.ping();
        health.elasticsearch.connected = true;
      } catch (error) {
        health.elasticsearch.connected = false;
        health.elasticsearch.error = error.message;
      }
    }

    health.status = (health.elasticsearch.enabled ? health.elasticsearch.connected : true) && 
                    health.mongodb.connected ? 'healthy' : 'degraded';

    return health;
  }
}

// Search middleware for Express routes
const createSearchMiddleware = (searchSystem) => {
  return {
    // Main search middleware
    search: async (req, res, next) => {
      try {
        const query = req.query.q || req.query.search || '';
        const options = {
          ...req.query,
          originalQuery: query,
          page: parseInt(req.query.page) || 1,
          limit: Math.min(parseInt(req.query.limit) || 20, 100),
          category: req.query.category,
          brand: req.query.brand,
          minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
          maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined,
          minRating: req.query.minRating ? parseFloat(req.query.minRating) : undefined,
          sortBy: req.query.sortBy,
          location: req.query.lat && req.query.lon ? {
            lat: parseFloat(req.query.lat),
            lon: parseFloat(req.query.lon)
          } : undefined,
          radius: req.query.radius ? parseFloat(req.query.radius) : undefined
        };

        const results = await searchSystem.search(query, options);
        res.json({
          success: true,
          ...results
        });
      } catch (error) {
        console.error('❌ Search middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Search failed',
          message: error.message
        });
      }
    },

    // Autocomplete middleware
    autocomplete: async (req, res, next) => {
      try {
        const query = req.query.q || '';
        const limit = Math.min(parseInt(req.query.limit) || 10, 20);
        
        const suggestions = await searchSystem.autocomplete(query, { limit });
        
        res.json({
          success: true,
          suggestions
        });
      } catch (error) {
        console.error('❌ Autocomplete middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Autocomplete failed',
          message: error.message
        });
      }
    },

    // Search suggestions middleware
    suggestions: async (req, res, next) => {
      try {
        const query = req.query.q || '';
        const limit = Math.min(parseInt(req.query.limit) || 5, 10);
        const userId = req.user?.id;
        
        const suggestions = await searchSystem.getSearchSuggestions(query, userId, limit);
        
        res.json({
          success: true,
          suggestions
        });
      } catch (error) {
        console.error('❌ Search suggestions middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Search suggestions failed',
          message: error.message
        });
      }
    }
  };
};

// Search route factory
const createSearchRoutes = (searchSystem) => {
  const router = require('express').Router();
  const middleware = createSearchMiddleware(searchSystem);

  // Main search endpoint
  router.get('/search', middleware.search);
  
  // Autocomplete endpoint
  router.get('/autocomplete', middleware.autocomplete);
  
  // Search suggestions endpoint
  router.get('/suggestions', middleware.suggestions);
  
  // Search health check
  router.get('/search/health', async (req, res) => {
    try {
      const health = await searchSystem.healthCheck();
      res.json({
        success: true,
        ...health
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        message: error.message
      });
    }
  });

  return router;
};

// Initialize and export
const advancedSearchSystem = new AdvancedSearchSystem();

module.exports = {
  AdvancedSearchSystem,
  advancedSearchSystem,
  createSearchMiddleware,
  createSearchRoutes
};
