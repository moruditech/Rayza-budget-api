const { getPaginationParams, buildPaginationMeta } = require('../../../src/utils/paginate');

describe('paginate', () => {
  describe('getPaginationParams', () => {
    it('defaults to page 1 and the given default limit', () => {
      expect(getPaginationParams({})).toEqual({ page: 1, limit: 20, skip: 0 });
    });

    it('parses page and limit from query params', () => {
      expect(getPaginationParams({ page: '3', limit: '10' })).toEqual({
        page: 3,
        limit: 10,
        skip: 20,
      });
    });

    it('clamps limit to maxLimit', () => {
      expect(getPaginationParams({ limit: '500' }, 20, 100)).toEqual({
        page: 1,
        limit: 100,
        skip: 0,
      });
    });

    it('treats page values below 1 as 1', () => {
      expect(getPaginationParams({ page: '-5' })).toEqual({ page: 1, limit: 20, skip: 0 });
    });

    it('falls back to defaults on non-numeric input', () => {
      expect(getPaginationParams({ page: 'abc', limit: 'xyz' })).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
    });
  });

  describe('buildPaginationMeta', () => {
    it('computes totalPages, rounding up', () => {
      expect(buildPaginationMeta(1, 20, 47)).toEqual({
        page: 1,
        limit: 20,
        total: 47,
        totalPages: 3,
      });
    });

    it('returns at least 1 totalPage when total is 0', () => {
      expect(buildPaginationMeta(1, 20, 0)).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      });
    });
  });
});
