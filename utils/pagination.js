/**
 * @fileoverview Utility functions for pagination.
 */
const getPaginatedResults = async (model, query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skipIndex = (page - 1) * limit;

  try {
    const totalResults = await model.countDocuments();
    const results = await model.find().skip(skipIndex).limit(limit);

    const pagination = {};

    if (skipIndex + results.length < totalResults) {
      pagination.next = {
        page: page + 1,
        limit,
      };
    }

    if (skipIndex > 0) {
      pagination.previous = {
        page: page - 1,
        limit,
      };
    }

    return {
      results,
      pagination
    };
  } catch (err) {
    console.error('Pagination utility error:', err);
    throw new Error('Failed to fetch paginated results.');
  }
};

module.exports = {
  getPaginatedResults,
};