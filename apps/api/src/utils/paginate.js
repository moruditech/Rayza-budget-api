/**
 * Parse and clamp page/limit query params into { page, limit, skip }.
 * @param {object} query - req.query
 * @param {number} [defaultLimit]
 * @param {number} [maxLimit]
 */
function getPaginationParams(query = {}, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/** Build the `meta` block for a paginated ApiResponse.success() call. */
function buildPaginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

module.exports = { getPaginationParams, buildPaginationMeta };
